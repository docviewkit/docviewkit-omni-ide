import { runTests } from "@vscode/test-electron";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:net";

const fixture = process.argv[2] || process.env.DOCVIEWKIT_TEST_FIXTURE || "image-worker.pdf";
const directory = await mkdtemp(resolve(tmpdir(), "omni-host-test-"));
const done = resolve(directory, "done");
const listener = createServer();
await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
let launchError;
const running = runTests({
  extensionDevelopmentPath: process.env.DOCVIEWKIT_TEST_EXTENSION || resolve("vscode"),
  extensionTestsPath: resolve("vscode/test/integration.mjs"),
  extensionTestsEnv: { DOCVIEWKIT_TEST_DONE: done, DOCVIEWKIT_TEST_FIXTURE: fixture },
  launchArgs: ["--disable-extensions", "--skip-welcome", "--skip-release-notes", `--remote-debugging-port=${port}`],
}).catch((error) => { launchError = error; });
const deadline = Date.now() + 60_000;
async function until(probe) {
  while (Date.now() < deadline) {
    if (launchError) throw launchError;
    const value = await probe();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("VS Code Webview did not become ready for image verification");
}
let socket;
try {
  // Electron exposes Webviews as separate iframe targets; ordinary browser frame lookup misses them.
  const target = await until(async () => {
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1_000) }).then((r) => r.json()).catch(() => []);
    return targets.find((target) => target.type === "iframe" && target.url.includes("extensionId=docviewkit.docviewkit-omni"));
  });
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let nextId = 0;
  const requests = new Map();
  const contexts = new Map();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      requests.get(message.id)?.(message);
      requests.delete(message.id);
    } else if (message.method === "Runtime.executionContextCreated") {
      contexts.set(message.params.context.id, message.params.context);
    } else if (message.method === "Runtime.executionContextDestroyed") {
      contexts.delete(message.params.executionContextId);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { requests.delete(id); reject(new Error(`${method} timed out`)); }, 15_000);
    requests.set(id, (message) => {
      clearTimeout(timer);
      message.error ? reject(new Error(message.error.message)) : resolve(message.result);
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
  await send("Runtime.enable");
  const contextId = await until(async () => {
    for (const id of contexts.keys()) {
      const result = await send("Runtime.evaluate", { contextId: id, expression: "document.querySelector('docviewkit-viewer')?.state.status === 'ready'", returnByValue: true });
      if (result.result.value) return id;
    }
  });
  const result = await send("Runtime.evaluate", {
    contextId, returnByValue: true,
    expression: `(() => {
      const canvas = document.querySelector('docviewkit-viewer').shadowRoot.querySelector('canvas.surface');
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      return [0.25, 0.75].flatMap(y => [0.375, 0.625].map(x => {
        const offset = (Math.floor(canvas.height * y) * canvas.width + Math.floor(canvas.width * x)) * 4;
        return [...pixels.slice(offset, offset + 4)];
      }));
    })()`,
  });
  const expected = fixture === "sample.ofd"
    ? [[230, 25, 25, 255], [230, 25, 25, 255], [25, 180, 70, 255], [25, 180, 70, 255]]
    : [[230, 25, 25, 255], [127, 217, 162, 255], [230, 25, 25, 255], [127, 217, 162, 255]];
  assert.deepEqual(result.result.value, expected, "Real VS Code must render the fixture content");
  console.log(`Real VS Code ${fixture} pixels passed`);
} finally {
  socket?.close();
  await writeFile(done, "done");
  await running;
  await rm(directory, { recursive: true, force: true });
}
if (launchError) throw launchError;
