import { randomBytes } from "node:crypto";
import { posix } from "node:path";
import * as vscode from "vscode";
import { allowedExternalUrl, contentSecurityPolicy, renderWebview, toArrayBuffer } from "./webview.js";

const VIEW_TYPE = "docviewkitOmni.preview";
const INTERFACE_VERSION = 1;

class OmniDocument implements vscode.CustomDocument {
  constructor(readonly uri: vscode.Uri) {}
  dispose(): void {}
}

class OmniEditorProvider implements vscode.CustomReadonlyEditorProvider<OmniDocument> {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly diagnostics: vscode.OutputChannel,
  ) {}

  openCustomDocument(uri: vscode.Uri): OmniDocument {
    return new OmniDocument(uri);
  }

  async resolveCustomEditor(
    document: OmniDocument,
    panel: vscode.WebviewPanel,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const viewerRoot = vscode.Uri.joinPath(this.context.extensionUri, "viewer");
    const templateBytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(viewerRoot, "index.html"));
    const nonce = randomBytes(18).toString("base64url");
    const webview = panel.webview;
    webview.options = { enableScripts: true, localResourceRoots: [viewerRoot] };
    const hostScript = webview.asWebviewUri(vscode.Uri.joinPath(viewerRoot, "host.js")).toString();
    // ponytail: VS Code Webviews reject cross-origin module Workers; remove when Viewer ships a Webview-safe worker entry.
    const hostBootstrap = "globalThis.docViewKitHost = acquireVsCodeApi(); globalThis.docViewKitHostExecution = 'inline';";
    const html = renderWebview(
      new TextDecoder().decode(templateBytes),
      contentSecurityPolicy(webview.cspSource, nonce),
      nonce,
      hostBootstrap,
      hostScript,
    );

    const name = posix.basename(document.uri.path);
    let revision = 0;
    let disposed = false;
    const post = (type: string, payload: object = {}) =>
      webview.postMessage({ version: INTERFACE_VERSION, type, payload });
    const load = async (type: "open" | "reload") => {
      const current = ++revision;
      try {
        const bytes = await vscode.workspace.fs.readFile(document.uri);
        if (!disposed && current === revision) await post(type, { name, bytes: toArrayBuffer(bytes) });
      } catch (error) {
        if (!disposed && current === revision) {
          this.log(name, { code: "HOST_READ_FAILED", message: String(error) });
          await post(type, {});
        }
      }
    };
    const sendTheme = () => post("theme", {
      theme: vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ||
        vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast ? "dark" : "light",
    });

    const base = document.uri.with({ path: posix.dirname(document.uri.path) });
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(base, name));
    const subscriptions = [
      watcher,
      watcher.onDidChange(() => void load("reload")),
      watcher.onDidCreate(() => void load("reload")),
      watcher.onDidDelete(() => void load("reload")),
      vscode.window.onDidChangeActiveColorTheme(() => void sendTheme()),
      webview.onDidReceiveMessage(async (message: unknown) => {
        if (!message || typeof message !== "object") return;
        const event = message as { version?: number; type?: string; payload?: Record<string, unknown> };
        if (event.version !== INTERFACE_VERSION) return;
        if (event.type === "ready") {
          await sendTheme();
          await post("locale", { locale: vscode.env.language });
          await load("open");
        } else if (event.type === "open-external" && typeof event.payload?.url === "string") {
          const url = allowedExternalUrl(event.payload.url);
          if (url) await vscode.env.openExternal(vscode.Uri.parse(url.href, true));
          else this.log(name, { code: "HOST_LINK_REJECTED", message: "Blocked unsafe document link" });
        } else if (event.type === "diagnostic" || event.type === "fatal-error") {
          this.log(name, event.payload ?? {});
        }
      }),
      panel.onDidDispose(() => {
        disposed = true;
        revision += 1;
        void post("dispose");
        subscriptions.forEach((subscription) => subscription !== watcher && subscription.dispose());
        watcher.dispose();
      }),
      token.onCancellationRequested(() => panel.dispose()),
    ];
    webview.html = html;
  }

  private log(fileName: string, value: unknown): void {
    this.diagnostics.appendLine(JSON.stringify(value).replaceAll(fileName, "[document]"));
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const diagnostics = vscode.window.createOutputChannel("DocViewKit Omni");
  context.subscriptions.push(
    diagnostics,
    vscode.window.registerCustomEditorProvider(
      VIEW_TYPE,
      new OmniEditorProvider(context, diagnostics),
      { supportsMultipleEditorsPerDocument: true, webviewOptions: { retainContextWhenHidden: false } },
    ),
  );
}

export function deactivate(): void {}
