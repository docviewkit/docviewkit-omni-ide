import assert from "node:assert/strict";
import * as vscode from "vscode";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

export async function run(_testsRoot, callback) {
  const directory = vscode.Uri.joinPath(vscode.Uri.file(process.env.TMPDIR || "/tmp"), `docviewkit-omni-${Date.now()}`);
  let failure;
  try {
    await vscode.workspace.fs.createDirectory(directory);
    await vscode.extensions.getExtension("docviewkit.docviewkit-omni").activate();
    const name = process.env.DOCVIEWKIT_TEST_FIXTURE || "image-worker.pdf";
    const document = vscode.Uri.joinPath(directory, name);
    await vscode.workspace.fs.writeFile(document, await readFile(new URL(`../../test/fixtures/${name}`, import.meta.url)));
    if (name.endsWith(".ofd")) await vscode.commands.executeCommand("vscode.open", document);
    else await vscode.commands.executeCommand("vscode.openWith", document, "docviewkitOmni.preview");
    const deadline = Date.now() + 5_000;
    let tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    while (!(tab?.input instanceof vscode.TabInputCustom) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    }
    assert.ok(tab?.input instanceof vscode.TabInputCustom, "DocViewKit Omni did not open a custom editor tab");
    assert.equal(tab.input.viewType, "docviewkitOmni.preview");
    const renderingDeadline = Date.now() + 60_000;
    while (!existsSync(process.env.DOCVIEWKIT_TEST_DONE) && Date.now() < renderingDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(existsSync(process.env.DOCVIEWKIT_TEST_DONE), "Webview pixel verification timed out");
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  } catch (error) {
    failure = error;
  } finally {
    await vscode.workspace.fs.delete(directory, { recursive: true, useTrash: false });
    callback(failure, failure ? 1 : 0);
  }
}
