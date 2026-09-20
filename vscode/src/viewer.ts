// VS Code only routes local resource requests made by the Webview, not its Workers.
// Keep the packaged worker unchanged and relay its package-local WASM reads through a private port.
function workerResources(source: string): void {
  const NativeURL = URL;
  const entry = import.meta.url;
  globalThis.URL = class extends NativeURL {
    constructor(url: string | URL, base?: string | URL) {
      super(url, base === entry ? source : base);
    }
  };
  let nextId = 0;
  const pending = new Map<number, { resolve: (response: Response) => void; reject: (error: Error) => void }>();
  const ready = new Promise<MessagePort>((resolve) => {
    addEventListener("message", (event: MessageEvent) => {
      if (!(event.data?.omniResourcePort instanceof MessagePort)) return;
      event.stopImmediatePropagation();
      const port: MessagePort = event.data.omniResourcePort;
      port.onmessage = ({ data }) => {
        const request = pending.get(data.id);
        if (!request) return;
        pending.delete(data.id);
        if (data.error) request.reject(new Error(data.error));
        else request.resolve(new Response(data.bytes, { status: data.status, headers: data.headers }));
      };
      resolve(port);
    });
  });
  const nativeFetch = globalThis.fetch;
  const packageRoot = new NativeURL(".", source).href;
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    if (!request.url.startsWith(packageRoot) || request.method !== "GET") return nativeFetch(input, init);
    const port = await ready;
    return new Promise<Response>((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      port.postMessage({ id, url: request.url });
    });
  };
}

async function installImageWorker(): Promise<void> {
  const source = new URL("../viewer/package/image-codec-worker.js", import.meta.url);
  const response = await fetch(source);
  if (!response.ok) throw new Error(`Image worker read failed (${response.status})`);
  const entry = URL.createObjectURL(new Blob([
    `(${workerResources.toString()})(${JSON.stringify(source.href)});\n`,
    await response.blob(),
  ], { type: "text/javascript" }));
  const packageRoot = new URL(".", source).href;
  const NativeWorker = Worker;
  // ponytail: intercept only Core's codec entry; remove when Core exposes a host worker/resource factory.
  globalThis.Worker = class extends NativeWorker {
    #resources?: { port: MessagePort; abort: AbortController };

    constructor(url: string | URL, options?: WorkerOptions) {
      const codec = String(url) === source.href && options?.type === "module";
      super(codec ? entry : url, options);
      if (!codec) return;
      const { port1, port2 } = new MessageChannel();
      const abort = new AbortController();
      this.#resources = { port: port1, abort };
      port1.onmessage = async ({ data }) => {
        if (!data || !Number.isSafeInteger(data.id) || typeof data.url !== "string") return;
        try {
          const url = new URL(data.url);
          if (!url.href.startsWith(packageRoot)) throw new Error("Worker resource rejected");
          const response = await fetch(url, { signal: abort.signal });
          const bytes = await response.arrayBuffer();
          port1.postMessage({ id: data.id, bytes, status: response.status, headers: [...response.headers] }, [bytes]);
        } catch (error) {
          port1.postMessage({ id: data.id, error: String(error) });
        }
      };
      this.postMessage({ omniResourcePort: port2 }, [port2]);
      this.addEventListener("error", () => this.terminate(), { once: true });
    }

    override terminate(): void {
      this.#resources?.abort.abort();
      this.#resources?.port.close();
      super.terminate();
    }
  };
  addEventListener("beforeunload", () => URL.revokeObjectURL(entry), { once: true });
}

const workerFailure = await installImageWorker().catch((error) => new Error(String(error)));
await import(new URL("../viewer/host.js", import.meta.url).href);
if (workerFailure) {
  document.querySelector("docviewkit-viewer")?.dispatchEvent(new CustomEvent("docviewkit-diagnostic", {
    detail: { diagnostics: [{ code: "HOST_IMAGE_WORKER_FAILED", severity: "warning", phase: "render", message: workerFailure.message }] },
  }));
}
