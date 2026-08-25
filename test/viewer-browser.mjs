import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, extname, join, normalize } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../build/viewer/", import.meta.url).pathname;
const chrome = process.env.DOCVIEWKIT_CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const fixturePath = process.env.DOCVIEWKIT_TEST_FILE;
const fixtureName = fixturePath ? basename(fixturePath) : "sample.csv";
const fixtureBytes = fixturePath ? await readFile(fixturePath) : new TextEncoder().encode("name,value\nalpha,42\n");
assert.ok(existsSync(chrome), `Chromium executable not found: ${chrome}`);

const template = await readFile(join(root, "index.html"), "utf8");
const html = template
  .replaceAll("{{CSP}}", "default-src 'none'; img-src 'self' blob: data:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self'")
  .replaceAll("{{NONCE}}", "")
  .replaceAll("{{HOST_BOOTSTRAP}}", "globalThis.docViewKitHost={messages:[],postMessage(message){globalThis.docViewKitHost.messages.push(message)}};")
  .replaceAll("{{HOST_SCRIPT}}", "/host.js");
const mime = { ".js": "text/javascript", ".json": "application/json", ".wasm": "application/wasm", ".md": "text/plain", ".txt": "text/plain" };
const server = createServer(async (request, response) => {
  try {
    if (request.url === "/") {
      response.setHeader("Content-Type", "text/html");
      response.end(html);
      return;
    }
    const path = normalize(join(root, new URL(request.url, "http://localhost").pathname));
    if (!path.startsWith(root)) throw new Error("unsafe path");
    response.setHeader("Content-Type", mime[extname(path)] || "application/octet-stream");
    response.end(await readFile(path));
  } catch (error) {
    console.log(`server 404 ${request.url}: ${error.message}`);
    response.statusCode = 404;
    response.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ executablePath: chrome, headless: true });
try {
  const page = await browser.newPage();
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto(origin);
  await page.waitForFunction(() => globalThis.docViewKitHost.messages.some((message) => message.type === "ready"));
  await page.evaluate(({ name, bytes }) => window.postMessage({
    version: 1,
    type: "open",
    payload: { name, bytes: new Uint8Array(bytes).buffer },
  }, "*"), { name: fixtureName, bytes: [...fixtureBytes] });
  try {
    await page.waitForFunction(() => globalThis.docViewKitHost.messages.some((message) => message.type === "document-ready"), undefined, { timeout: 10_000 });
  } catch (error) {
    error.cause = await page.evaluate(() => globalThis.docViewKitHost.messages);
    throw error;
  }
  const result = await page.evaluate(() => {
    const viewer = document.querySelector("docviewkit-viewer");
    return {
      state: viewer.state,
      ready: globalThis.docViewKitHost.messages.find((message) => message.type === "document-ready").payload,
      renderedCanvases: [...viewer.shadowRoot.querySelectorAll("canvas")].filter((canvas) => canvas.width > 0 && canvas.height > 0).length,
    };
  });
  assert.equal(result.state.status, "ready");
  if (fixturePath) {
    assert.equal(result.ready.format, extname(fixtureName).slice(1).toLowerCase());
    assert.ok(result.ready.unitCount > 0, "Viewer reported no document units");
  } else {
    assert.deepEqual(result.ready, { format: "csv", kind: "spreadsheet", unitCount: 1 });
  }
  assert.ok(result.renderedCanvases > 0, "Viewer did not render a document canvas");
  assert.deepEqual([...new Set(requests.map((url) => new URL(url).origin))], [origin]);
  await page.evaluate(() => window.postMessage({ version: 1, type: "dispose", payload: {} }, "*"));
  await page.waitForFunction(() => document.querySelector("docviewkit-viewer").state.status === "destroyed");
  console.log(`Viewer browser smoke passed: ${fixtureName} rendered locally with no remote requests`);
} finally {
  await browser.close();
  server.close();
}
