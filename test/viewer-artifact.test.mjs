import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("builds one pinned, self-contained Viewer artifact for both adapters", async () => {
  const output = await mkdtemp(join(tmpdir(), "docviewkit-omni-"));
  try {
    const build = spawnSync(process.execPath, ["scripts/build-viewer.mjs", output], {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
    });
    assert.equal(build.status, 0, build.stderr || build.stdout);

    const manifest = JSON.parse(await readFile(join(output, "manifest.json"), "utf8"));
    assert.deepEqual(manifest, {
      interfaceVersion: 1,
      package: {
        name: "@docviewkit/viewer",
        version: "0.2.56",
        integrity: "sha512-qxoZIlL7C/YJSa39FIkKsDFzF+FHRUN9XOfgnDlU5irxpcrAy4MGffDhG7ivVtWsa8w1bRuNo2x33RNOOBiJnQ==",
      },
      extensions: [
        "pptx", "pptm", "ppsx", "ppsm", "potx", "potm",
        "xlsx", "xlsm", "xltx", "xltm",
        "docx", "docm", "dotx", "dotm",
        "csv", "rtf",
        "odp", "otp", "fodp", "ods", "ots", "fods", "odt", "ott", "fodt",
        "pages", "numbers", "key",
        "doc", "xls", "ppt",
        "wps", "et", "dps",
        "pdf", "xps", "oxps",
      ],
      files: manifest.files,
    });
    assert.match(manifest.files["host.js"], /^[a-f0-9]{64}$/u);
    assert.match(manifest.files["index.html"], /^[a-f0-9]{64}$/u);
    assert.match(manifest.files["package/viewer.js"], /^[a-f0-9]{64}$/u);
    assert.match(manifest.files["package/office-viewer-core.wasm"], /^[a-f0-9]{64}$/u);
    assert.match(await readFile(join(output, "package/FREE_VIEWER_LICENSE.md"), "utf8"), /DocViewKit Free Viewer License/u);
    const vscode = JSON.parse(await readFile(new URL("../vscode/package.json", import.meta.url), "utf8"));
    const selector = vscode.contributes.customEditors[0].selector[0].filenamePattern;
    assert.deepEqual(selector.slice(selector.indexOf("{") + 1, selector.indexOf("}")).split(","), manifest.extensions);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
