package com.docviewkit.omni

import java.net.URI

private val allowedProtocols = setOf("http", "https", "mailto", "tel")
private val supportedExtensions by lazy {
    requireNotNull(BridgeMarker::class.java.getResourceAsStream("/viewer/extensions.txt")) {
        "Viewer extension manifest is missing"
    }.bufferedReader().useLines { lines -> lines.filter(String::isNotBlank).toSet() }
}

private object BridgeMarker

data class ViewerResource(val bytes: ByteArray, val mimeType: String)

fun allowedExternalUri(value: String): URI? = try {
    URI(value).takeIf {
        it.isAbsolute && it.scheme.lowercase() in allowedProtocols &&
            if (it.scheme.equals("http", true) || it.scheme.equals("https", true)) it.host != null
            else it.rawSchemeSpecificPart.isNotBlank()
    }
} catch (_: Exception) {
    null
}

fun isSupportedFileName(name: String): Boolean = name.substringAfterLast('.', "").lowercase() in supportedExtensions

fun viewerResource(path: String, documentBytes: ByteArray?): ViewerResource? {
    if (path == "/document") return documentBytes?.let { ViewerResource(it, "application/octet-stream") }
    if (!path.matches(Regex("/[A-Za-z0-9._/-]+")) || ".." in path) return null
    val bytes = BridgeMarker::class.java.getResourceAsStream("/viewer$path")?.use { it.readBytes() } ?: return null
    val mimeType = when (path.substringAfterLast('.', "")) {
        "js" -> "text/javascript"
        "json" -> "application/json"
        "wasm" -> "application/wasm"
        "html" -> "text/html"
        "css" -> "text/css"
        "md", "txt" -> "text/plain"
        else -> "application/octet-stream"
    }
    return ViewerResource(bytes, mimeType)
}

fun renderViewerHtml(
    template: String,
    csp: String,
    nonce: String,
    hostBootstrap: String,
    hostScript: String,
): String = template
    .replace("{{CSP}}", csp)
    .replace("{{NONCE}}", nonce)
    .replace("{{HOST_BOOTSTRAP}}", hostBootstrap)
    .replace("{{HOST_SCRIPT}}", hostScript)
    .also { require("{{" !in it) { "Viewer template contains an unresolved token" } }
