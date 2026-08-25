package com.docviewkit.omni

import org.junit.Assert.assertEquals
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AdapterContractTest {
    @Test
    fun `renders the shared shell and only accepts explicit external protocols`() {
        assertEquals(
            "default-src 'none'|nonce|window.host()|https://docviewkit-omni.invalid/host.js",
            renderViewerHtml(
                "{{CSP}}|{{NONCE}}|{{HOST_BOOTSTRAP}}|{{HOST_SCRIPT}}",
                "default-src 'none'",
                "nonce",
                "window.host()",
                "https://docviewkit-omni.invalid/host.js",
            ),
        )
        assertEquals("https", allowedExternalUri("https://docviewkit.com/docs/")?.scheme)
        assertEquals("mailto", allowedExternalUri("mailto:support@docviewkit.com")?.scheme)
        assertNull(allowedExternalUri("https:relative"))
        assertNull(allowedExternalUri("mailto:"))
        assertNull(allowedExternalUri("file:///tmp/private.docx"))
        assertNull(allowedExternalUri("javascript:alert(1)"))
    }

    @Test
    fun `uses the shared artifact format list`() {
        assertTrue(isSupportedFileName("proposal.DOCX"))
        assertTrue(isSupportedFileName("slides.ppsm"))
        assertTrue(isSupportedFileName("sheet.et"))
        assertFalse(isSupportedFileName("notes.txt"))
        assertFalse(isSupportedFileName("no-extension"))
    }

    @Test
    fun `serves only bundled Viewer assets and the current document bytes`() {
        assertTrue(viewerResource("/host.js", null)?.bytes?.isNotEmpty() == true)
        assertEquals("text/javascript", viewerResource("/host.js", null)?.mimeType)
        assertArrayEquals(byteArrayOf(1, 2, 3), viewerResource("/document", byteArrayOf(1, 2, 3))?.bytes)
        assertNull(viewerResource("/../package.json", null))
        assertNull(viewerResource("/document", null))
    }
}
