# DocViewKit Omni

DocViewKit Omni provides local, read-only document preview inside VS Code and JetBrains IDEs. Version 0.1.0 pins the unmodified `@docviewkit/viewer@0.2.53` package as its only parser and renderer.

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

The browser smoke requires Chrome at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, or set `DOCVIEWKIT_CHROME`. Outputs are `vscode/docviewkit-omni-0.1.5.vsix` and `jetbrains/build/distributions/docviewkit-omni-0.1.0.zip`.

Document bytes stay in the IDE/Webview/JCEF process. Runtime scripts, fonts, Wasm, and format packs come only from the packaged Viewer artifact; document links are handed to the host after protocol validation.

See [PROJECT_SPEC.md](PROJECT_SPEC.md) for scope and release requirements.
