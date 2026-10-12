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
        version: "0.2.77",
        integrity: "sha512-nm09gzP9vD46esYJG6d1YEyeV9cuA7ITru0J2PAGOM4EyCrLBzsB9U6Dljo1DwUvzsOPuNL59FC7rj6QhQMUbA==",
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
        "pdf", "xps", "oxps", "ofd",
      ],
      files: manifest.files,
    });
    assert.match(manifest.files["host.js"], /^[a-f0-9]{64}$/u);
    assert.match(manifest.files["index.html"], /^[a-f0-9]{64}$/u);
    assert.match(manifest.files["package/viewer.js"], /^[a-f0-9]{64}$/u);
    assert.match(manifest.files["package/office-viewer-core.wasm"], /^[a-f0-9]{64}$/u);
    for (const family of ["Carlito", "Caladea"]) {
      for (const face of ["Regular", "Bold", "Italic", "BoldItalic"]) {
        assert.match(manifest.files[`package/${family}-${face}.ttf`], /^[a-f0-9]{64}$/u);
      }
    }
    assert.match(await readFile(join(output, "package/LICENSE"), "utf8"), /Apache License\s+Version 2\.0/u);
    assert.match(await readFile(join(output, "package/NOTICE"), "utf8"), /DocViewKit/u);
    assert.ok((await readFile(join(output, "package/THIRD_PARTY_NOTICES.md"), "utf8")).length > 0);
    const vscode = JSON.parse(await readFile(new URL("../vscode/package.json", import.meta.url), "utf8"));
    const selector = vscode.contributes.customEditors[0].selector[0].filenamePattern;
    assert.deepEqual(selector.slice(selector.indexOf("{") + 1, selector.indexOf("}")).split(","), manifest.extensions);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test("marketplace metadata leads with local document preview and searchable formats", async () => {
  const vscode = JSON.parse(await readFile(new URL("../vscode/package.json", import.meta.url), "utf8"));
  assert.match(vscode.description, /^Preview Office, PDF, OFD, OpenDocument, and iWork files locally/u);
  assert.match(vscode.description, /without uploads or a conversion server/u);
  for (const keyword of ["office viewer", "document preview", "docx viewer", "xlsx viewer", "pptx viewer", "pdf viewer", "ofd viewer"]) {
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
  assert.match(jetbrains, /<p>Preview Office, PDF, OFD, OpenDocument, and iWork files without leaving your JetBrains IDE\./u);
  assert.match(jetbrains, /Documents stay on your device or IDE-managed remote workspace—no uploads and no conversion server\./u);
});

test("public READMEs and marketplace pages describe the current OFD boundary", async () => {
  for (const path of ["README.md", "vscode/README.md", "jetbrains/README.md", "jetbrains/src/main/resources/META-INF/plugin.xml"]) {
    const content = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    assert.match(content, /OFD 1\.0 and 1\.1/u, `${path}: missing Core OFD capability`);
    assert.match(content, /\.ofd/u, `${path}: missing file extension`);
    assert.match(content, /does not provide trusted digital-signature validation/u, `${path}: missing signature boundary`);
  }
});
