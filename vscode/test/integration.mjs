import assert from "node:assert/strict";
import * as vscode from "vscode";

export async function run(_testsRoot, callback) {
  const directory = vscode.Uri.joinPath(vscode.Uri.file(process.env.TMPDIR || "/tmp"), `docviewkit-omni-${Date.now()}`);
  let failure;
  try {
    await vscode.workspace.fs.createDirectory(directory);
    const document = vscode.Uri.joinPath(directory, "sample.csv");
    await vscode.workspace.fs.writeFile(document, new TextEncoder().encode("name,value\nalpha,42\n"));
    await vscode.commands.executeCommand("vscode.openWith", document, "docviewkitOmni.preview");
    const deadline = Date.now() + 5_000;
    let tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    while (!(tab?.input instanceof vscode.TabInputCustom) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    }
    assert.ok(tab?.input instanceof vscode.TabInputCustom, "DocViewKit Omni did not open a custom editor tab");
    assert.equal(tab.input.viewType, "docviewkitOmni.preview");
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  } catch (error) {
    failure = error;
  } finally {
    await vscode.workspace.fs.delete(directory, { recursive: true, useTrash: false });
    callback(failure, failure ? 1 : 0);
  }
}
