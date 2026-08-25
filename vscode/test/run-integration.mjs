import { runTests } from "@vscode/test-electron";
import { resolve } from "node:path";

await runTests({
  extensionDevelopmentPath: resolve("vscode"),
  extensionTestsPath: resolve("vscode/test/integration.mjs"),
  launchArgs: ["--disable-extensions", "--skip-welcome", "--skip-release-notes"],
});
