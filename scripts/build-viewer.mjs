import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, process.argv[2] || "build/viewer");
if (["/", root, resolve(homedir())].includes(output)) throw new Error(`Refusing unsafe output path: ${output}`);

const packageRoot = join(root, "node_modules/@docviewkit/viewer");
const [contract, packageJson, lock] = await Promise.all([
  readFile(join(root, "viewer/contract.json"), "utf8").then(JSON.parse),
  readFile(join(packageRoot, "package.json"), "utf8").then(JSON.parse),
  readFile(join(root, "package-lock.json"), "utf8").then(JSON.parse),
]);
const locked = lock.packages?.["node_modules/@docviewkit/viewer"];
if (packageJson.version !== "0.2.53" || locked?.version !== packageJson.version || !locked.integrity) {
  throw new Error("@docviewkit/viewer must be installed from the pinned lockfile");
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await Promise.all([
  cp(packageRoot, join(output, "package"), { recursive: true }),
  cp(join(root, "viewer/index.html"), join(output, "index.html")),
  cp(join(root, "viewer/host.js"), join(output, "host.js")),
]);
await writeFile(join(output, "extensions.txt"), `${contract.extensions.join("\n")}\n`);

const files = {};
async function hashDirectory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await hashDirectory(path);
    else files[relative(output, path)] = createHash("sha256").update(await readFile(path)).digest("hex");
  }
}
await hashDirectory(output);
await writeFile(join(output, "manifest.json"), `${JSON.stringify({
  ...contract,
  package: { name: packageJson.name, version: packageJson.version, integrity: locked.integrity },
  files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))),
}, null, 2)}\n`);
