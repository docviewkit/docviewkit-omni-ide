import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { allowedExternalUrl, contentSecurityPolicy, renderWebview, toArrayBuffer } from "../dist/webview.js";

test("renders a closed Webview shell and only accepts explicit external protocols", () => {
  const html = renderWebview(
    "{{CSP}}|{{NONCE}}|{{HOST_BOOTSTRAP}}|{{HOST_SCRIPT}}",
    "default-src 'none'",
    "fixed-nonce",
    "globalThis.docViewKitHost = acquireVsCodeApi();",
    "vscode-resource:/viewer/host.js",
  );
  assert.equal(html, "default-src 'none'|fixed-nonce|globalThis.docViewKitHost = acquireVsCodeApi();|vscode-resource:/viewer/host.js");
  assert.equal(allowedExternalUrl("https://docviewkit.com/docs/")?.protocol, "https:");
  assert.equal(allowedExternalUrl("mailto:support@docviewkit.com")?.protocol, "mailto:");
  assert.equal(allowedExternalUrl("file:///tmp/private.docx"), undefined);
  assert.equal(allowedExternalUrl("javascript:alert(1)"), undefined);
});

test("allows Viewer shadow styles and listens before loading the Webview", async () => {
  const csp = contentSecurityPolicy("vscode-webview:", "fixed-nonce");
  assert.match(csp, /style-src vscode-webview: 'unsafe-inline'/u);
  assert.doesNotMatch(csp, /style-src[^;]*nonce/u);
  assert.match(csp, /script-src[^;]*'nonce-fixed-nonce'/u);

  const source = await readFile(new URL("../src/extension.ts", import.meta.url), "utf8");
  assert.ok(source.indexOf("webview.onDidReceiveMessage") < source.indexOf("webview.html = html"));
});

test("sends document bytes as an exact ArrayBuffer", () => {
  const source = new Uint8Array([9, 1, 2, 8]).subarray(1, 3);
  const result = toArrayBuffer(source);
  assert.ok(result instanceof ArrayBuffer);
  assert.deepEqual([...new Uint8Array(result)], [1, 2]);
});
