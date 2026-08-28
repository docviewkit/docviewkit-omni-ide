# DocViewKit Omni

DocViewKit Omni provides local, read-only document preview inside VS Code and JetBrains IDEs. Version 0.1.11 pins the unmodified `@docviewkit/viewer@0.2.56` package as its only parser and renderer.

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

The browser smoke requires Chrome at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, or set `DOCVIEWKIT_CHROME`. Outputs are `vscode/docviewkit-omni-0.1.11.vsix` and `jetbrains/build/distributions/docviewkit-omni-0.1.11.zip`.

Document bytes stay in the IDE/Webview/JCEF process. Runtime scripts, fonts, Wasm, and format packs come only from the packaged Viewer artifact; document links are handed to the host after protocol validation.

## Marketplace publishing

The `Publish` GitHub Actions workflow runs when a non-prerelease GitHub Release is published. Its `vX.Y.Z` tag must match the root, VS Code, and JetBrains package versions. It builds, tests, verifies both packages contain the same Viewer artifact, then publishes them. A manual run accepts an existing tag and can publish only VS Code or JetBrains, which is useful for first submissions and marketplace-specific retries.

One-time setup:

1. Create the VS Code Marketplace publisher `docviewkit`. Create an Azure DevOps personal access token with Marketplace Manage permission and add it as the `VS_MARKETPLACE_TOKEN` environment secret.
2. Upload the first JetBrains ZIP manually on JetBrains Marketplace. Generate a Marketplace token and add it as the `JETBRAINS_MARKETPLACE_TOKEN` environment secret.
3. Add the Base64-encoded JetBrains signing certificate and encrypted private key as `JETBRAINS_CERTIFICATE_CHAIN` and `JETBRAINS_PRIVATE_KEY`, plus its password as `JETBRAINS_PRIVATE_KEY_PASSWORD`.
4. Protect the `marketplace` GitHub environment with required reviewers if releases need manual approval.

For later releases, update all three package versions, push the commit and tag, then publish the matching GitHub Release. Use a manual run only when one marketplace must be published independently.

See [PROJECT_SPEC.md](PROJECT_SPEC.md) for scope and release requirements.
