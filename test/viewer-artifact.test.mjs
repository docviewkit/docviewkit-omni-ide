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
        version: "0.2.65",
        integrity: "sha512-ducs8QLeCRtgV8AUrlo7bbCsjRNLKQIsX7U+a48bh6b2pNp2tWMKHFIf0iRBIZBFa5W3uZ6AEZJLVsnX2Dl5Zw==",
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

test("marketplace metadata leads with local document preview and searchable formats", async () => {
  const vscode = JSON.parse(await readFile(new URL("../vscode/package.json", import.meta.url), "utf8"));
  assert.match(vscode.description, /^Preview Office, PDF, OpenDocument, and iWork files locally/u);
  assert.match(vscode.description, /without uploads or a conversion server/u);
  for (const keyword of ["office viewer", "document preview", "docx viewer", "xlsx viewer", "pptx viewer", "pdf viewer"]) {
    assert.ok(vscode.keywords.includes(keyword), `missing Marketplace keyword: ${keyword}`);
  }
  assert.equal(vscode.repository.directory, "vscode");
  assert.match(vscode.scripts.package, /--baseImagesUrl https:\/\/raw\.githubusercontent\.com\/docviewkit\/docviewkit-omni-ide\/HEAD\/vscode/u);
  const readme = await readFile(new URL("../vscode/README.md", import.meta.url), "utf8");
  const screenshots = [...readme.matchAll(/!\[[^\]]+\]\((assets\/[^)]+\.png)\)/gu)].map((match) => match[1]);
  assert.deepEqual(screenshots.sort(), [
    "assets/marketplace-docx.png",
    "assets/marketplace-pptx.png",
    "assets/marketplace-preview.png",
    "assets/marketplace-xlsx.png",
  ]);
  for (const screenshot of screenshots) {
    const png = await readFile(new URL(`../vscode/${screenshot}`, import.meta.url));
    assert.deepEqual(png.subarray(0, 8), Buffer.from("89504e470d0a1a0a", "hex"));
    assert.ok(png.readUInt32BE(16) >= 1_000 && png.readUInt32BE(20) >= 600, `${screenshot} is too small`);
  }

  const jetbrains = await readFile(new URL("../jetbrains/src/main/resources/META-INF/plugin.xml", import.meta.url), "utf8");
  assert.match(jetbrains, /<p>Preview Office, PDF, OpenDocument, and iWork files without leaving your JetBrains IDE\./u);
  assert.match(jetbrains, /Documents stay on your device or IDE-managed remote workspace—no uploads and no conversion server\./u);
});
