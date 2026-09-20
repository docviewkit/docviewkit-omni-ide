import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, extname, join, normalize } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../build/viewer/", import.meta.url).pathname;
const chrome = process.env.DOCVIEWKIT_CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const fixturePath = process.env.DOCVIEWKIT_TEST_FILE || process.argv.slice(3).find((arg) => !arg.startsWith("--"));
const missingWorker = process.argv.includes("--missing-image-worker");
const fixtureName = fixturePath ? basename(fixturePath) : "sample.csv";
const fixtureBytes = fixturePath ? await readFile(fixturePath) : new TextEncoder().encode("name,value\nalpha,42\n");
const adapter = process.argv[2] || "vscode";
assert.ok(["vscode", "jetbrains"].includes(adapter));
assert.ok(existsSync(chrome), `Chromium executable not found: ${chrome}`);

const template = await readFile(join(root, "index.html"), "utf8");
let html;
const renderHtml = (origin, resourceOrigin) => template
  .replace("<head>", "<head><style>:root { --vscode-editor-background: #1e1e1e; } @layer vscode-default { body { padding: 0 20px; } }</style>")
  .replaceAll("{{CSP}}", `default-src 'none'; img-src ${resourceOrigin} blob: data:; font-src ${resourceOrigin} data:; style-src ${resourceOrigin} 'unsafe-inline'; script-src ${resourceOrigin} 'unsafe-inline' 'wasm-unsafe-eval'; worker-src ${resourceOrigin} blob:; connect-src ${origin} ${resourceOrigin}`)
  .replaceAll("{{NONCE}}", "")
  .replaceAll("{{HOST_BOOTSTRAP}}", `globalThis.docViewKitHost={messages:[],postMessage(message){globalThis.docViewKitHost.messages.push(message)}};globalThis.docViewKitInitial={theme:'dark',locale:'en',background:${JSON.stringify(adapter === "vscode" ? "var(--vscode-editor-background, #fff)" : "rgb(30 30 30)")}};${adapter === "vscode" ? "globalThis.docViewKitHostExecution='inline';" : ""}`)
  .replaceAll("{{HOST_SCRIPT}}", adapter === "vscode" ? `${resourceOrigin.replace("127", "%31%32%37")}/adapter/viewer.js` : `${origin}/host.js`);
const mime = { ".js": "text/javascript", ".json": "application/json", ".wasm": "application/wasm", ".md": "text/plain", ".txt": "text/plain" };
const serve = async (request, response) => {
  try {
    response.setHeader("Access-Control-Allow-Origin", origin);
    if (request.url === "/") {
      response.setHeader("Content-Type", "text/html");
      response.end(html);
      return;
    }
    if (request.url === "/document") {
      response.setHeader("Content-Type", "application/octet-stream");
      response.end(fixtureBytes);
      return;
    }
    const pathname = new URL(request.url, "http://localhost").pathname;
    if (missingWorker && pathname.endsWith("/image-codec-worker.js")) {
      response.writeHead(404).end();
      return;
    }
    if (pathname === "/adapter/viewer.js") {
      response.setHeader("Content-Type", "text/javascript");
      response.end(await readFile(new URL("../vscode/dist/viewer.js", import.meta.url)));
      return;
    }
    const path = normalize(join(root, pathname.replace(/^\/viewer\//u, "/")));
    if (!path.startsWith(root)) throw new Error("unsafe path");
    response.setHeader("Content-Type", mime[extname(path)] || "application/octet-stream");
    response.end(await readFile(path));
  } catch (error) {
    console.log(`server 404 ${request.url}: ${error.message}`);
    response.statusCode = 404;
    response.end();
  }
};
const server = createServer(serve);
const resources = createServer(serve);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const origin = `http://127.0.0.1:${address.port}`;
await new Promise((resolve) => resources.listen(0, "127.0.0.1", resolve));
const resourceOrigin = adapter === "vscode" ? `http://127.0.0.1:${resources.address().port}` : origin;
html = renderHtml(origin, resourceOrigin);
const browser = await chromium.launch({ executablePath: chrome, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 935, height: 800 }, colorScheme: "light" });
  const requests = [];
  const errors = [];
  page.on("request", (request) => requests.push(request.url()));
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") errors.push(message.text());
  });
  await page.goto(origin);
  assert.equal(await page.title(), "DocViewKit Omni");
  await page.waitForFunction(() => globalThis.docViewKitHost.messages.some((message) => message.type === "ready"));
  const firstFrame = await page.evaluate(() => {
    const viewer = document.querySelector("docviewkit-viewer");
    return {
      theme: viewer.dataset.resolvedTheme,
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      viewerBackground: getComputedStyle(viewer.shadowRoot.querySelector(".shell")).backgroundColor,
    };
  });
  assert.deepEqual(firstFrame, {
    theme: "dark",
    bodyBackground: "rgb(30, 30, 30)",
    viewerBackground: "rgb(23, 25, 29)",
  }, "Viewer first frame must use its native dark palette while the host page keeps the IDE background");
  await page.evaluate(({ name, bytes, adapter }) => window.postMessage({
    version: 1,
    type: "open",
    payload: adapter === "vscode" ? { name, bytes: new Uint8Array(bytes).buffer } : { name, url: `${location.origin}/document` },
  }, "*"), { name: fixtureName, bytes: [...fixtureBytes], adapter });
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
  if (["image-worker.pdf", "sample.ofd"].includes(fixtureName)) {
    // Flate RGB plus a soft mask matches receipt images; JPEG2000 also requires the codec's WASM.
    const colors = await page.locator("docviewkit-viewer canvas.surface").first().evaluate((canvas) => {
      const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      return [0.25, 0.75].flatMap((y) => [0.375, 0.625].map((x) => {
        const offset = (Math.floor(canvas.height * y) * canvas.width + Math.floor(canvas.width * x)) * 4;
        return [...pixels.slice(offset, offset + 4)];
      }));
    });
    const expected = fixtureName === "sample.ofd"
      ? [[230, 25, 25, 255], [230, 25, 25, 255], [25, 180, 70, 255], [25, 180, 70, 255]]
      : [[230, 25, 25, 255], [127, 217, 162, 255], [230, 25, 25, 255], [127, 217, 162, 255]];
    assert.deepEqual(colors, expected, "The fixture content must render as expected");
  }
  const imageDiagnostics = await page.evaluate(() => globalThis.docViewKitHost.messages
    .flatMap((message) => message.payload?.diagnostics || [])
    .filter((diagnostic) => diagnostic.code.startsWith("IMAGE_") && diagnostic.fidelity === "not-rendered"));
  assert.deepEqual(imageDiagnostics, [], "Image decode failures must not be hidden by document-ready");
  if (missingWorker) {
    assert.ok(await page.evaluate(() => globalThis.docViewKitHost.messages
      .some((message) => message.payload?.diagnostics?.some((d) => d.code === "HOST_IMAGE_WORKER_FAILED"))),
    "An unavailable codec must retain a diagnostic while CSV rendering remains usable");
  }
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
  const canvasBeforeTheme = await page.locator("docviewkit-viewer canvas.surface").evaluate((canvas) => canvas.toDataURL());
  const assertTheme = async (theme, background) => {
    await page.waitForFunction((theme) => document.querySelector("docviewkit-viewer").state.theme === theme, theme, { timeout: 2_000 });
    await page.locator("docviewkit-viewer .shell").evaluate((shell) => Promise.all(shell.getAnimations().map((animation) => animation.finished)));
    assert.equal(await page.locator("docviewkit-viewer .shell").evaluate((shell) => getComputedStyle(shell).backgroundColor), background,
      `${adapter}: Viewer must use its native ${theme} palette without a host background override`);
    assert.equal(await page.locator("docviewkit-viewer canvas.surface").evaluate((canvas) => canvas.toDataURL()), canvasBeforeTheme,
      "Changing the shell theme must preserve document pixels");
  };
  // A native Viewer choice must work, and the next IDE theme change must still take effect.
  await page.locator('docviewkit-viewer [data-action="theme"]').click();
  await assertTheme("light", "rgb(238, 240, 243)");
  for (const theme of ["dark", "light", "dark"]) {
    await page.evaluate((theme) => window.postMessage({
      version: 1, type: "theme", payload: { theme, background: theme === "dark" ? "rgb(30 30 30)" : "rgb(255 255 255)" },
    }, "*"), theme);
    await assertTheme(theme, theme === "dark" ? "rgb(23, 25, 29)" : "rgb(238, 240, 243)");
  }
  await page.screenshot({ path: `/tmp/docviewkit-omni-${adapter}-dark.png` });
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
  assert.deepEqual([...new Set(requests.map((url) => new URL(url).origin))].sort(), [...new Set([origin, resourceOrigin])].sort());
  if (missingWorker) {
    assert.ok(errors.length > 0 && errors.every((error) => error === `404 ${resourceOrigin}/viewer/package/image-codec-worker.js`
      || error.startsWith("Failed to load resource: the server responded with a status of 404")), errors.join("\n"));
  } else {
    assert.deepEqual(errors, [], "Viewer must not emit browser errors or warnings");
  }
  await page.evaluate(() => window.postMessage({ version: 1, type: "dispose", payload: {} }, "*"));
  await page.waitForFunction(() => document.querySelector("docviewkit-viewer").state.status === "destroyed");
  console.log(`Viewer browser smoke passed (${adapter}): ${fixtureName}, native theme controls and IDE changes, unchanged document pixels, ${missingWorker ? "expected codec warning with usable preview" : "no browser errors or remote requests"}`);
} finally {
  await browser.close();
  server.close();
  resources.close();
}
