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
  .replace("<head>", "<head><style>@layer vscode-default { body { padding: 0 20px; } }</style>")
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
  const page = await browser.newPage({ viewport: { width: 935, height: 800 } });
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
      controls: {
        printHidden: viewer.shadowRoot.querySelector('[data-action="print"]').hidden,
        fullscreenHidden: viewer.shadowRoot.querySelector('[data-action="fullscreen"]').hidden,
        interactionSwitcherHidden: viewer.shadowRoot.querySelector(".interaction-switcher").hidden,
        interactionModes: [...viewer.shadowRoot.querySelectorAll(".interaction-switcher [data-interaction-mode]")]
          .map((button) => button.dataset.interactionMode),
      },
      toolbarOverflow: (() => {
        const toolbar = viewer.shadowRoot.querySelector(".toolbar");
        return toolbar.scrollWidth - toolbar.clientWidth;
      })(),
      toolbarAlignment: (() => {
        const toolbar = viewer.shadowRoot.querySelector(".toolbar");
        const toolbarRect = toolbar.getBoundingClientRect();
        const shellRect = viewer.shadowRoot.querySelector(".shell").getBoundingClientRect();
        const visible = [...toolbar.children].map((child) => child.getBoundingClientRect()).filter((rect) => rect.width > 0);
        const switcher = viewer.shadowRoot.querySelector(".interaction-switcher").getBoundingClientRect();
        return {
          leftInset: visible[0].left - shellRect.left,
          rightInset: shellRect.right - visible.at(-1).right,
          toolbarRightOverflow: toolbarRect.right - shellRect.right,
          switcherCenterDelta: (switcher.left + switcher.right - shellRect.left - shellRect.right) / 2,
        };
      })(),
      hostLayout: (() => {
        const viewerRect = viewer.getBoundingClientRect();
        const buttons = [...viewer.shadowRoot.querySelectorAll(".toolbar button")]
          .filter((button) => button.getBoundingClientRect().width > 0);
        const firstIcon = buttons[0].querySelector("svg").getBoundingClientRect();
        const lastIcon = buttons.at(-1).querySelector("svg").getBoundingClientRect();
        const clientWidth = document.documentElement.clientWidth;
        return {
          clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          viewerLeft: viewerRect.left,
          viewerRight: viewerRect.right,
          visibleIconInsets: [
            firstIcon.left - Math.max(0, viewerRect.left),
            Math.min(clientWidth, viewerRect.right) - lastIcon.right,
          ],
        };
      })(),
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
  assert.equal(result.toolbarOverflow, 0, `Viewer toolbar overflows by ${result.toolbarOverflow}px`);
  assert.ok(result.toolbarAlignment.toolbarRightOverflow <= 0,
    `Viewer toolbar exceeds its clipping boundary by ${result.toolbarAlignment.toolbarRightOverflow}px`);
  assert.ok(Math.abs(result.toolbarAlignment.switcherCenterDelta) <= 1,
    `Interaction switcher is ${result.toolbarAlignment.switcherCenterDelta}px off center`);
  assert.ok(result.toolbarAlignment.rightInset >= 31.5,
    `Right toolbar inset is only ${result.toolbarAlignment.rightInset}px`);
  assert.equal(result.hostLayout.scrollWidth, result.hostLayout.clientWidth, "Host page overflows horizontally");
  assert.equal(result.hostLayout.viewerLeft, 0, "Viewer does not start at the visible host boundary");
  assert.equal(result.hostLayout.viewerRight, result.hostLayout.clientWidth, "Viewer exceeds the visible host boundary");
  if (result.ready.format === "pdf") {
    assert.ok(Math.abs(result.hostLayout.visibleIconInsets[0] - result.hostLayout.visibleIconInsets[1]) <= 1,
      `Visible toolbar insets are asymmetric: ${result.hostLayout.visibleIconInsets.join("px / ")}px`);
  }
  assert.deepEqual(result.controls, {
    printHidden: true,
    fullscreenHidden: true,
    interactionSwitcherHidden: false,
    interactionModes: ["object", "display", "text"],
  });
  for (const width of [721, 720]) {
    await page.setViewportSize({ width, height: 800 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
    const compact = await page.evaluate(() => {
      const root = document.querySelector("docviewkit-viewer").shadowRoot;
      const toolbar = root.querySelector(".toolbar");
      const switcher = root.querySelector(".interaction-switcher").getBoundingClientRect();
      const controls = [...toolbar.querySelectorAll("button, .page-position, .zoom-value")]
        .filter((control) => !control.closest(".interaction-switcher") && control.getBoundingClientRect().width > 0)
        .map((control) => control.getBoundingClientRect());
      return {
        overflow: toolbar.scrollWidth - toolbar.clientWidth,
        overlaps: controls.some((control) => control.left < switcher.right && control.right > switcher.left),
      };
    });
    assert.deepEqual(compact, { overflow: 0, overlaps: false }, `Toolbar layout failed at ${width}px`);
  }
  assert.deepEqual([...new Set(requests.map((url) => new URL(url).origin))], [origin]);
  await page.evaluate(() => window.postMessage({ version: 1, type: "dispose", payload: {} }, "*"));
  await page.waitForFunction(() => document.querySelector("docviewkit-viewer").state.status === "destroyed");
  console.log(`Viewer browser smoke passed: ${fixtureName} rendered locally with no remote requests`);
} finally {
  await browser.close();
  server.close();
}
