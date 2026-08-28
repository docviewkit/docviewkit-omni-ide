import "./package/viewer.js";
import { extendedFormatPack } from "./package/extended-formats.js";

const INTERFACE_VERSION = 1;
const viewer = document.querySelector("docviewkit-viewer");
const host = globalThis.docViewKitHost;
let generation = 0;

if (!viewer || !host?.postMessage) throw new Error("DocViewKit Omni host bootstrap is unavailable");

const layout = document.createElement("style");
layout.textContent = `
  @container docviewkit (min-width: 721px) {
    .toolbar { position: relative; padding-inline: 32px; }
    .interaction-switcher:not([hidden]) { position: absolute; inset-inline-start: 50%; transform: translateX(-50%); }
  }
`;
viewer.shadowRoot.append(layout);

const post = (type, payload = {}) => host.postMessage({ version: INTERFACE_VERSION, type, payload });
const errorPayload = (error, fallback) => ({
  code: typeof error?.code === "string" ? error.code : fallback,
  message: error instanceof Error ? error.message : String(error),
});
const safeName = (name) => String(name || "document").split(/[\\/]/u).pop().slice(0, 255) || "document";

viewer.config = {
  engine: {
    ...(globalThis.docViewKitHostExecution === "inline" ? { execution: "inline" } : {}),
    formatPack: async () => extendedFormatPack,
  },
  features: {
    print: false,
    fullscreen: false,
    interactionModeSwitcher: true,
    hyperlinks: true,
  },
};

globalThis.open = (target) => {
  try {
    const url = new URL(String(target));
    if (!["http:", "https:", "mailto:", "tel:"].includes(url.protocol)) return null;
    post("open-external", { url: url.href });
  } catch {}
  return null;
};

viewer.addEventListener("docviewkit-diagnostic", ({ detail }) => post("diagnostic", detail));
viewer.addEventListener("docviewkit-error", ({ detail }) =>
  post("diagnostic", errorPayload(detail?.cause, "VIEWER_RENDER_FAILED")));

async function sourceFrom(payload) {
  if (payload?.url) {
    const url = new URL(payload.url, location.href);
    if (url.origin !== location.origin) throw Object.assign(new Error("Cross-origin document URL rejected"), { code: "HOST_SOURCE_REJECTED" });
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw Object.assign(new Error(`Document read failed (${response.status})`), { code: "HOST_READ_FAILED" });
    return new File([await response.arrayBuffer()], safeName(payload.name));
  }
  const bytes = payload?.bytes;
  if (bytes instanceof ArrayBuffer || ArrayBuffer.isView(bytes) || Array.isArray(bytes)) {
    return new File([bytes], safeName(payload.name));
  }
  throw Object.assign(new Error("Document bytes are missing"), { code: "HOST_SOURCE_MISSING" });
}

async function open(payload) {
  const current = ++generation;
  try {
    await viewer.close();
    const source = await sourceFrom(payload);
    if (current !== generation) return;
    const info = await viewer.open(source);
    if (current !== generation) return;
    post("document-ready", { format: info.format, kind: info.kind, unitCount: info.units.length });
  } catch (error) {
    if (current === generation && error?.name !== "AbortError") post("fatal-error", errorPayload(error, "VIEWER_OPEN_FAILED"));
  }
}

addEventListener("message", ({ data }) => {
  if (!data || data.version !== INTERFACE_VERSION) {
    post("diagnostic", { code: "HOST_INTERFACE_MISMATCH", message: "Unsupported host interface version" });
    return;
  }
  switch (data.type) {
    case "open":
    case "reload":
      void open(data.payload);
      break;
    case "theme":
      viewer.config = { ...viewer.config, theme: data.payload?.theme === "dark" ? "dark" : "light" };
      break;
    case "locale":
      viewer.config = { ...viewer.config, locale: String(data.payload?.locale || "en") };
      break;
    case "dispose":
      generation += 1;
      viewer.destroy();
      break;
    default:
      post("diagnostic", { code: "HOST_UNKNOWN_MESSAGE", message: `Ignored host message: ${String(data.type)}` });
  }
});

addEventListener("beforeunload", () => viewer.destroy(), { once: true });
post("ready");
