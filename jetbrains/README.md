# DocViewKit Omni for JetBrains

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

Requires a compatible JetBrains IDE based on IntelliJ Platform **2025.2 or newer** (build **252+**) and a bundled JetBrains Runtime with **JCEF**. Use the versions supported by the plugin's Marketplace compatibility listing. If JCEF is unavailable, the plugin shows an explicit diagnostic; it does not substitute an image preview or a remote conversion service.

Install **DocViewKit Omni** through **Settings → Plugins → Marketplace**, then open a supported file in the IDE. To install an offline build, download the JetBrains ZIP from the available release or build artifacts and use **Install Plugin from Disk…**. Supported local files can be previewed without a network connection after installation. IDE-managed remote workspace behavior depends on the host's filesystem and browser support.

## Troubleshooting

If JCEF is unavailable, switch to the IDE's bundled JetBrains Runtime with JCEF. If a document renders incorrectly, copy the relevant DocViewKit Omni messages from the IDE log and include the plugin version, IDE version, file format, and reproduction steps in an [issue](https://github.com/docviewkit/docviewkit-omni-ide/issues). Remove private paths or document content before sharing; attach a document only if you have permission.

The bundled DocViewKit Viewer includes every available format and is licensed under Apache-2.0. Third-party components retain their included notices. DocViewKit Omni is powered by [DocViewKit Viewer](https://docviewkit.com/).

[Privacy Policy](https://docviewkit.com/privacy/docviewkit-omni/) · [End User License Agreement](https://docviewkit.com/license/docviewkit-omni/) · [Report an issue](https://github.com/docviewkit/docviewkit-omni-ide/issues)

## Adapter and build

The Kotlin adapter registers a `FileEditorProvider`, serves packaged Viewer resources and current document bytes from the private `https://docviewkit-omni.invalid` JCEF origin, reloads on VFS changes, and disposes the browser/query with the editor.

Build with `JAVA_HOME=/path/to/jdk-21 ./gradlew clean test buildPlugin verifyPluginStructure`.
