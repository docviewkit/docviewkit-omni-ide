import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = new URL("..", import.meta.url).pathname;
const temp = await mkdtemp(join(tmpdir(), "docviewkit-omni-packages-"));
const unpack = (archive, output) => {
  const result = spawnSync("unzip", ["-q", archive, "-d", output], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
};
async function find(directory, suffix) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      const match = await find(path, suffix);
      if (match) return match;
    } else if (path.endsWith(suffix)) return path;
  }
}
async function verify(viewerRoot, manifest) {
  for (const [path, expected] of Object.entries(manifest.files)) {
    const actual = createHash("sha256").update(await readFile(join(viewerRoot, path))).digest("hex");
    assert.equal(actual, expected, path);
  }
}

try {
  const vscode = join(temp, "vscode");
  const jetbrains = join(temp, "jetbrains");
  unpack(join(root, "vscode/docviewkit-omni-0.1.0.vsix"), vscode);
  unpack(join(root, "jetbrains/build/distributions/docviewkit-omni-0.1.0.zip"), jetbrains);
  const jar = await find(jetbrains, ".jar");
  assert.ok(jar, "JetBrains plugin jar missing");
  const jarRoot = join(temp, "jar");
  unpack(jar, jarRoot);

  const vscodeRoot = join(vscode, "extension/viewer");
  const jetbrainsRoot = join(jarRoot, "viewer");
  const vscodeManifest = JSON.parse(await readFile(join(vscodeRoot, "manifest.json"), "utf8"));
  const jetbrainsManifest = JSON.parse(await readFile(join(jetbrainsRoot, "manifest.json"), "utf8"));
  assert.deepEqual(jetbrainsManifest, vscodeManifest);
  await Promise.all([verify(vscodeRoot, vscodeManifest), verify(jetbrainsRoot, jetbrainsManifest)]);
  console.log(`Package contract passed: ${Object.keys(vscodeManifest.files).length} identical Viewer files`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
