const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

export const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer;

export function contentSecurityPolicy(cspSource: string, nonce: string): string {
  return [
    "default-src 'none'",
    `img-src ${cspSource} blob: data:`,
    `font-src ${cspSource} data:`,
    `style-src ${cspSource} 'unsafe-inline'`,
    `script-src ${cspSource} 'nonce-${nonce}' 'wasm-unsafe-eval'`,
    `worker-src ${cspSource} blob:`,
    `connect-src ${cspSource}`,
  ].join("; ");
}

export function allowedExternalUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return ALLOWED_PROTOCOLS.has(url.protocol) ? url : undefined;
  } catch {
    return undefined;
  }
}

export function renderWebview(
  template: string,
  csp: string,
  nonce: string,
  hostBootstrap: string,
  hostScript: string,
): string {
  const html = template
    .replaceAll("{{CSP}}", csp)
    .replaceAll("{{NONCE}}", nonce)
    .replaceAll("{{HOST_BOOTSTRAP}}", hostBootstrap)
    .replaceAll("{{HOST_SCRIPT}}", hostScript);
  if (html.includes("{{")) throw new Error("Viewer template contains an unresolved token");
  return html;
}
