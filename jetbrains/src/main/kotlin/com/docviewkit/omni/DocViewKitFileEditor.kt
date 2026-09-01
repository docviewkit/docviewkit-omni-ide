package com.docviewkit.omni

import com.intellij.ide.BrowserUtil
import com.intellij.ide.ui.LafManager
import com.intellij.ide.ui.LafManagerListener
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.fileEditor.FileEditorPolicy
import com.intellij.openapi.fileEditor.FileEditorProvider
import com.intellij.openapi.fileEditor.FileEditorState
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.UserDataHolderBase
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.vfs.VirtualFileManager
import com.intellij.openapi.vfs.newvfs.BulkFileListener
import com.intellij.openapi.vfs.newvfs.events.VFileEvent
import com.intellij.ui.components.JBLabel
import com.intellij.ui.JBColor
import com.intellij.ui.jcef.JBCefApp
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefBrowserBase
import com.intellij.ui.jcef.JBCefJSQuery
import com.intellij.ui.jcef.utils.JBCefStreamResourceHandler
import com.intellij.util.ui.JBUI
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.handler.CefRequestHandlerAdapter
import org.cef.handler.CefResourceHandler
import org.cef.handler.CefResourceRequestHandler
import org.cef.handler.CefResourceRequestHandlerAdapter
import org.cef.misc.BoolRef
import org.cef.misc.IntRef
import org.cef.misc.StringRef
import org.cef.network.CefRequest
import org.cef.network.CefResponse
import java.awt.BorderLayout
import java.beans.PropertyChangeListener
import java.beans.PropertyChangeSupport
import java.net.URI
import java.util.Locale
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import javax.swing.JComponent
import javax.swing.JPanel

private const val ORIGIN = "https://docviewkit-omni.invalid"
private const val INTERFACE_VERSION = 1

class DocViewKitFileEditorProvider : FileEditorProvider {
    override fun accept(project: Project, file: VirtualFile): Boolean = !file.isDirectory && isSupportedFileName(file.name)
    override fun createEditor(project: Project, file: VirtualFile): FileEditor = DocViewKitFileEditor(project, file)
    override fun getEditorTypeId(): String = "docviewkit-omni-preview"
    override fun getPolicy(): FileEditorPolicy = FileEditorPolicy.HIDE_DEFAULT_EDITOR
}

private class DocViewKitFileEditor(
    project: Project,
    private val file: VirtualFile,
) : UserDataHolderBase(), FileEditor {
    private val changes = PropertyChangeSupport(this)
    private val disposed = AtomicBoolean()
    private val revision = AtomicLong()
    private val browser: JBCefBrowser?
    private val query: JBCefJSQuery?
    private val root: JComponent
    @Volatile private var documentBytes: ByteArray? = null

    init {
        if (!JBCefApp.isSupported()) {
            browser = null
            query = null
            root = JPanel(BorderLayout()).apply {
                border = JBUI.Borders.empty(24)
                add(JBLabel("<html><h2>DocViewKit Omni</h2>JCEF is unavailable / JCEF 不可用。<br>Use the IDE's bundled JetBrains Runtime with JCEF.</html>"), BorderLayout.NORTH)
            }
        } else {
            val cefBrowser = JBCefBrowser()
            val cefQuery = JBCefJSQuery.create(cefBrowser as JBCefBrowserBase)
            browser = cefBrowser
            query = cefQuery
            root = cefBrowser.component

            cefQuery.addHandler { message ->
                handleMessage(message)
                null
            }
            cefBrowser.jbCefClient.addRequestHandler(createRequestHandler(), cefBrowser.cefBrowser)
            cefBrowser.setOpenLinksInExternalBrowser(false)
            cefBrowser.disableNavigation()

            val nonce = UUID.randomUUID().toString().replace("-", "")
            val template = requireNotNull(javaClass.getResourceAsStream("/viewer/index.html")) {
                "Viewer template is missing"
            }.bufferedReader().use { it.readText() }
            val csp = listOf(
                "default-src 'none'",
                "img-src 'self' blob: data:",
                "font-src 'self' data:",
                "style-src 'self' 'unsafe-inline' 'nonce-$nonce'",
                "script-src 'self' 'nonce-$nonce' 'wasm-unsafe-eval'",
                "worker-src 'self' blob:",
                "connect-src 'self'",
            ).joinToString("; ")
            val bootstrap = "globalThis.docViewKitHost={postMessage(message){${cefQuery.inject("JSON.stringify(message)")}}};"
            cefBrowser.loadHTML(renderViewerHtml(template, csp, nonce, bootstrap, "$ORIGIN/host.js"), "$ORIGIN/")

            project.messageBus.connect(this).apply {
                subscribe(VirtualFileManager.VFS_CHANGES, object : BulkFileListener {
                    override fun after(events: List<VFileEvent>) {
                        if (events.any { it.path == file.path }) loadDocument("reload")
                    }
                })
                subscribe(LafManagerListener.TOPIC, object : LafManagerListener {
                    override fun lookAndFeelChanged(source: LafManager) = sendTheme()
                })
            }
        }
    }

    private fun handleMessage(message: String) {
        when (Regex("\\\"type\\\"\\s*:\\s*\\\"([a-z-]+)\\\"").find(message)?.groupValues?.get(1)) {
            "ready" -> {
                sendTheme()
                post("locale", "{\"locale\":${jsonString(Locale.getDefault().toLanguageTag())}}")
                loadDocument("open")
            }
            "open-external" -> Regex("\\\"url\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"").find(message)
                ?.groupValues?.get(1)?.replace("\\/", "/")?.let(::allowedExternalUri)?.let(BrowserUtil::browse)
            "diagnostic", "fatal-error" -> LOG.warn(message.replace(file.name, "[document]"))
        }
    }

    private fun loadDocument(type: String) {
        val current = revision.incrementAndGet()
        documentBytes = null
        ApplicationManager.getApplication().executeOnPooledThread {
            val bytes = try {
                file.contentsToByteArray()
            } catch (error: Exception) {
                LOG.warn("DocViewKit Omni could not read the document", error)
                null
            }
            if (disposed.get() || revision.get() != current) return@executeOnPooledThread
            documentBytes = bytes
            ApplicationManager.getApplication().invokeLater {
                if (disposed.get() || revision.get() != current) return@invokeLater
                val payload = bytes?.let {
                    "{\"name\":${jsonString(file.name)},\"url\":\"$ORIGIN/document?revision=$current\"}"
                } ?: "{}"
                post(type, payload)
            }
        }
    }

    private fun sendTheme() = post("theme", "{\"theme\":\"${if (JBColor.isBright()) "light" else "dark"}\"}")

    private fun post(type: String, payload: String = "{}") {
        browser?.cefBrowser?.executeJavaScript(
            "window.postMessage({version:$INTERFACE_VERSION,type:${jsonString(type)},payload:$payload},'*');",
            ORIGIN,
            0,
        )
    }

    private fun createRequestHandler() = object : CefRequestHandlerAdapter() {
        private val resources: CefResourceRequestHandler = object : CefResourceRequestHandlerAdapter() {
            override fun getResourceHandler(browser: CefBrowser, frame: CefFrame, request: CefRequest): CefResourceHandler {
                val uri = runCatching { URI(request.url) }.getOrNull()
                if (uri?.scheme != "https" || uri.host != "docviewkit-omni.invalid") return BytesHandler(null, 403, this@DocViewKitFileEditor)
                return BytesHandler(viewerResource(uri.path, documentBytes), 200, this@DocViewKitFileEditor)
            }
        }

        override fun getResourceRequestHandler(
            browser: CefBrowser,
            frame: CefFrame,
            request: CefRequest,
            isNavigation: Boolean,
            isDownload: Boolean,
            requestInitiator: String,
            disableDefaultHandling: BoolRef,
        ): CefResourceRequestHandler = resources
    }

    override fun getComponent(): JComponent = root
    override fun getPreferredFocusedComponent(): JComponent = root
    override fun getName(): String = "DocViewKit Omni"
    override fun setState(state: FileEditorState) {}
    override fun isModified(): Boolean = false
    override fun isValid(): Boolean = !disposed.get() && file.isValid
    override fun addPropertyChangeListener(listener: PropertyChangeListener) = changes.addPropertyChangeListener(listener)
    override fun removePropertyChangeListener(listener: PropertyChangeListener) = changes.removePropertyChangeListener(listener)
    override fun getFile(): VirtualFile = file

    override fun dispose() {
        if (!disposed.compareAndSet(false, true)) return
        revision.incrementAndGet()
        documentBytes = null
        query?.dispose()
        browser?.dispose()
    }

    companion object {
        private val LOG = Logger.getInstance(DocViewKitFileEditor::class.java)
    }
}

private class BytesHandler(resource: ViewerResource?, requestedStatus: Int, parent: Disposable) :
    JBCefStreamResourceHandler(
        (resource?.bytes ?: ByteArray(0)).inputStream(),
        resource?.mimeType ?: "text/plain",
        parent,
        mapOf("Cache-Control" to if (resource?.mimeType == "application/octet-stream") "no-store" else "public, max-age=31536000, immutable"),
    ) {
    private val status = if (resource == null && requestedStatus == 200) 404 else requestedStatus

    override fun getResponseHeaders(response: CefResponse, responseLength: IntRef, redirectUrl: StringRef) {
        super.getResponseHeaders(response, responseLength, redirectUrl)
        response.status = status
    }
}

private fun jsonString(value: String): String = buildString {
    append('"')
    value.forEach { char ->
        when (char) {
            '"', '\\' -> append('\\').append(char)
            '\n' -> append("\\n")
            '\r' -> append("\\r")
            '\t' -> append("\\t")
            else -> append(char)
        }
    }
    append('"')
}
