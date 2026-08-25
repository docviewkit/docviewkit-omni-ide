# VS Code adapter

The adapter registers `docviewkitOmni.preview` as a `CustomReadonlyEditorProvider`, reads files through `workspace.fs`, reloads changed files with stale-read cancellation, and exposes only the packaged Viewer directory to its Webview.

Run `npm run package:vscode` from the repository root to compile it, stage the shared Viewer artifact, and create the VSIX.
