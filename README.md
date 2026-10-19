# DocViewKit Omni

DocViewKit Omni brings fast, private, read-only document preview to VS Code and JetBrains IDEs. Open Office, PDF, OFD, OpenDocument, iWork, and other supported files without uploading them or running a document-conversion server.

- Every available format is included for free.
- Documents are parsed, rendered, and searched locally inside the IDE.
- Format components load on demand for fast startup and lower resource use.
- Navigation, zoom, search, text selection, safe hyperlinks, and interaction modes are built in where supported.
- Active document content is not executed, and isolated failures do not unnecessarily hide the rest of the document.
- Local and IDE-managed remote workspaces use the host's own filesystem, permissions, theme, language, and lifecycle APIs.

Supported families include modern and legacy Word, Excel, and PowerPoint; OpenDocument; Apple Pages, Numbers, and Keynote; WPS Office; PDF; OFD; XPS; RTF; and CSV. See the [VS Code Marketplace description](vscode/README.md) for the complete extension list.

Both adapters pin the unmodified `@docviewkit/viewer@0.2.79` package as their only parser and renderer. The native Viewer theme is set before the component loads and follows IDE theme changes without overriding the Viewer's palette.

## OFD preview

Preview OFD 1.0 and 1.1 fixed-layout documents (`.ofd`) locally in a read-only editor, without uploading them or using a conversion server. Open an OFD file normally to view its document content and page layout. Rendering covers the supported subset of OFD; the plugin does not provide trusted digital-signature validation.

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

The browser smoke requires Chrome at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, or set `DOCVIEWKIT_CHROME`. Outputs are `vscode/docviewkit-omni-0.1.25.vsix` and `jetbrains/build/distributions/docviewkit-omni-0.1.25.zip`.

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
