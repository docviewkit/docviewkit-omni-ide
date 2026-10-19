# DocViewKit Omni

DocViewKit Omni is a read-only document previewer for developers and technical teams. Read specifications, spreadsheets, presentations, reports, and reference documents alongside your code. The bundled DocViewKit Viewer parses and renders supported documents inside the IDE; no Office installation, document upload, account sign-in, or conversion server is required to preview files. Every available format is included for free.

## What you can preview

| Document family | File extensions |
| --- | --- |
| Word and rich text | `docx`, `docm`, `dotx`, `dotm`, `doc`, `rtf` |
| Excel and tabular data | `xlsx`, `xlsm`, `xltx`, `xltm`, `xls`, `csv` |
| PowerPoint | `pptx`, `pptm`, `ppsx`, `ppsm`, `potx`, `potm`, `ppt` |
| OpenDocument text | `odt`, `ott`, `fodt` |
| OpenDocument spreadsheets | `ods`, `ots`, `fods` |
| OpenDocument presentations | `odp`, `otp`, `fodp` |
| Apple iWork | `pages`, `numbers`, `key` |
| WPS Office | `wps`, `et`, `dps` |
| Fixed-layout documents | `pdf`, `ofd`, `xps`, `oxps` |

Rendering depth varies by format and document.

## Reading tools

- **Navigation:** browse document pages, presentation slides, and workbook sheets; use thumbnails where the format supports them.
- **Zoom:** inspect small text, tables, diagrams, and other document details at a comfortable scale.
- **Search:** find document text and navigate to matching content where supported.
- **Text selection:** select and copy readable text where supported by the format and interaction mode.
- **Interaction modes and external links:** switch between available reading interactions; validated external links open through the IDE's normal handler.
- **IDE integration:** previews follow IDE theme changes and use the IDE language where a matching Viewer translation is available. Files refresh when the host reports a change, and preview resources are released when the editor closes.

## Privacy and workspaces

Parsing, rendering, and search run inside the IDE's preview environment. The plugin does not upload document contents or send file names and paths to a remote service. Runtime scripts, fonts, Wasm, and format components are bundled with the extension; format components load on demand without downloading remote executable code.

Files are read through the IDE's filesystem and permission APIs. In an IDE-managed remote workspace, file access follows that host's connection and permissions. Document bytes are passed to the preview environment, so a remote workspace does not imply that all processing stays on the remote machine. Opening an external link uses the IDE's usual external application or browser and can contact that destination.

## Compatibility and limits

DocViewKit Omni is read-only. Document editing, annotations, and format conversion are outside its scope. Macros and active document content are not executed. Print and fullscreen controls are disabled in the IDE integration.

Layout, fonts, complex objects, and embedded resources depend on the format and bundled Viewer version. Complex or older documents, including some legacy iWork variants, may be incomplete or unsupported. Isolated object or resource failures are handled on a best-effort basis so usable content can remain visible. Preview support does not guarantee that every feature of the original authoring application is reproduced.

### OFD preview

Preview OFD 1.0 and 1.1 fixed-layout documents (`.ofd`) locally in a read-only editor, without uploading them or using a conversion server. Open an OFD file normally to view its document content and page layout. Rendering covers the supported subset of OFD; the plugin does not provide trusted digital-signature validation.

## Installation and requirements

- **VS Code:** desktop VS Code 1.125.0 or newer, with Webview support. Install `docviewkit.docviewkit-omni` from [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=docviewkit.docviewkit-omni) or [Open VSX](https://open-vsx.org/extension/docviewkit/docviewkit-omni).
- **Offline VS Code:** download the VSIX and SHA-256 file from [GitHub Releases](https://github.com/docviewkit/docviewkit-omni-ide/releases), verify the checksum, then choose **Install from VSIX…**.
- **JetBrains:** a compatible IntelliJ Platform 2025.2+ IDE (build 252+) using its bundled JetBrains Runtime with JCEF. Install from **Settings → Plugins → Marketplace**, or install an available plugin ZIP from disk. JCEF unavailability produces a diagnostic.

Open a supported file normally. In VS Code, use **Open With… → DocViewKit Omni** if another editor is selected. Supported local files can be previewed offline after installation; extension installation and updates use the host's distribution service. Other VS Code-compatible editors and remote workspace configurations need their own host compatibility validation.

## Troubleshooting

Check the file extension, required IDE version, and selected file editor first. VS Code diagnostics appear in **View → Output → DocViewKit Omni**; JetBrains diagnostics appear in the IDE log. Report the plugin version, IDE version, format, and steps to reproduce in an [issue](https://github.com/docviewkit/docviewkit-omni-ide/issues). Remove private paths or document content before sharing, and provide a file only if you have permission.

The bundled DocViewKit Viewer includes every available format and is licensed under Apache-2.0. Third-party components retain their included notices. DocViewKit Omni is powered by [DocViewKit Viewer](https://docviewkit.com/).

[Privacy Policy](https://docviewkit.com/privacy/docviewkit-omni/) · [End User License Agreement](https://docviewkit.com/license/docviewkit-omni/) · [Report an issue](https://github.com/docviewkit/docviewkit-omni-ide/issues)

Both adapters pin the unmodified `@docviewkit/viewer@0.2.79` package as their parser and renderer.

## Architecture

- `viewer/`: the small, shared host-message interface; it contains no parser or renderer.
- `vscode/`: VS Code `CustomReadonlyEditorProvider` and Webview adapter.
- `jetbrains/`: IntelliJ Platform `FileEditorProvider` and JCEF adapter.
- `scripts/build-viewer.mjs`: copies the pinned npm package and emits a SHA-256 manifest consumed by both packages.

## Build and test

```sh
npm ci --ignore-scripts
npm test
npm run test:browser
npm run test:vscode-host
npm run package:vscode
JAVA_HOME=/path/to/jdk-21 ./jetbrains/gradlew -p jetbrains clean test buildPlugin verifyPluginStructure verifyPlugin
npm run test:packages
```

The browser smoke requires Chrome at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, or set `DOCVIEWKIT_CHROME`. Outputs are `vscode/docviewkit-omni-0.1.26.vsix` and `jetbrains/build/distributions/docviewkit-omni-0.1.26.zip`.

Document bytes stay in the IDE/Webview/JCEF process. Runtime scripts, fonts, Wasm, and format packs come only from the packaged Viewer artifact; document links are handed to the host after protocol validation.

## Marketplace publishing

The `Publish` GitHub Actions workflow runs when a non-prerelease GitHub Release is published. Its `vX.Y.Z` tag must match the root, VS Code, and JetBrains package versions. It builds, tests, and verifies both adapters contain the same Viewer artifact. One VSIX is attached to that Release with a `.vsix.sha256` checksum, then the identical file is published to Visual Studio Marketplace and Open VSX. Each consumer verifies the checksum before publishing. Retries reuse the existing Release VSIX and checksum instead of overwriting them with a new build. A missing or invalid checksum stops publication.

A manual run requires an existing GitHub Release and accepts these targets:

| Target | Publishes |
| --- | --- |
| `all` | Both extension markets, Release VSIX, and JetBrains Marketplace |
| `vscode` | Both extension markets and Release VSIX |
| `vs-marketplace` | Visual Studio Marketplace and Release VSIX |
| `openvsx` | Open VSX and Release VSIX |
| `vsix` | Release VSIX and checksum only |
| `jetbrains` | JetBrains Marketplace only |

The two extension markets run independently after the Release VSIX is available, so one market's failure does not block the other. Use **Re-run failed jobs** to retry a failed publication, or select the corresponding manual target. Publishing CLIs are installed from the requested release tag's lockfile.

One-time setup:

1. Create the Visual Studio Marketplace publisher `docviewkit`. Create an Azure DevOps personal access token with Marketplace Manage permission and add it as the `VS_MARKETPLACE_TOKEN` secret in the `marketplace` GitHub environment. See [Microsoft's publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).
2. Sign in to Open VSX, complete the Eclipse publisher agreement, create the `docviewkit` namespace, and request ownership. Generate an Open VSX access token with permission to publish in that namespace and add it as `OPEN_VSX_TOKEN` in the same GitHub environment. The extension identity remains `docviewkit.docviewkit-omni`. See [Open VSX publishing](https://github.com/eclipse-openvsx/openvsx/wiki/Publishing-Extensions) and [namespace ownership](https://github.com/eclipse-openvsx/openvsx/wiki/Namespace-Access).
3. Upload the first JetBrains ZIP manually on JetBrains Marketplace. Generate a Marketplace token and add it as the `JETBRAINS_MARKETPLACE_TOKEN` environment secret.
4. Add the Base64-encoded JetBrains signing certificate and encrypted private key as `JETBRAINS_CERTIFICATE_CHAIN` and `JETBRAINS_PRIVATE_KEY`, plus its password as `JETBRAINS_PRIVATE_KEY_PASSWORD`.
5. Protect the `marketplace` GitHub environment with required reviewers if releases need manual approval. The VSIX attachment job uses the workflow's `GITHUB_TOKEN` with `contents: write`; it does not need a separate personal token.

For later releases, update all three package versions, push the commit and tag, then publish the matching GitHub Release. Use a manual run only when one marketplace must be published independently.

Offline users can download the VSIX and its checksum from [GitHub Releases](https://github.com/docviewkit/docviewkit-omni-ide/releases), verify it with `sha256sum -c docviewkit-omni-X.Y.Z.vsix.sha256` (macOS: `shasum -a 256 -c docviewkit-omni-X.Y.Z.vsix.sha256`), and use **Extensions → Install from VSIX…**. Open VSX availability does not certify compatibility with every consuming editor; each host's preview behavior still needs validation.

See [PROJECT_SPEC.md](PROJECT_SPEC.md) for scope and release requirements.
