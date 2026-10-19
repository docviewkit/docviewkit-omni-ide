import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, chmod, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { load } from "js-yaml";

const root = new URL("..", import.meta.url).pathname;
const workflow = load(await readFile(join(root, ".github/workflows/publish.yml"), "utf8"));
const { version } = JSON.parse(await readFile(join(root, "vscode/package.json"), "utf8"));
const filename = `docviewkit-omni-${version}.vsix`;
const temp = await mkdtemp(join(tmpdir(), "omni-publish-"));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const run = (step) => spawnSync("bash", ["-e", "-o", "pipefail", "-c", step.run], {
  cwd: temp,
  env: { ...process.env, PATH: `${temp}/bin:${process.env.PATH}`, TAG: `v${version}`,
    GH_REPO: "docviewkit/docviewkit-omni-ide", CALLS: join(temp, "calls.jsonl"), REMOTE: join(temp, "remote") },
  encoding: "utf8",
});
try {
  // Exercise the workflow commands with a real packaged extension; replace only
  // the network clients so regression runs cannot publish anything.
  const bytes = await readFile(join(root, "vscode", filename));
  await mkdir(join(temp, "bin"));
  await mkdir(join(temp, "remote"));
  await mkdir(join(temp, "vscode"));
  await copyFile(join(root, "vscode", filename), join(temp, "vscode", filename));
  for (const client of ["npx", "gh"]) {
    const path = join(temp, "bin", client);
    await writeFile(path, `#!/usr/bin/env node
const fs = require('node:fs');
const crypto = require('node:crypto');
const args = process.argv.slice(2);
if ('${client}' === 'gh' && args[1] === 'view') {
  console.log(fs.readdirSync(process.env.REMOTE).join('\\n'));
  process.exit(0);
}
if ('${client}' === 'gh' && args[1] === 'download') {
  for (const file of fs.readdirSync(process.env.REMOTE)) fs.copyFileSync(process.env.REMOTE + '/' + file, file);
  process.exit(0);
}
const file = args.find(a => a.endsWith('.vsix'));
if (!file) process.exit(2);
if ('${client}' === 'gh') for (const file of args.filter(a => /\\.vsix(\\.sha256)?$/.test(a))) {
  fs.copyFileSync(file, process.env.REMOTE + '/' + file);
}
fs.appendFileSync(process.env.CALLS, JSON.stringify({client: '${client}', args,
  hash: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}) + '\\n');
`);
    await chmod(path, 0o755);
  }
  const checksum = workflow.jobs.build.steps.find(s => s.name === "Checksum VSIX");
  assert.ok(checksum, "Build must checksum the VSIX once for all release consumers");
  const checked = run(checksum);
  assert.equal(checked.status, 0, checked.stderr);
  await mkdir(join(temp, "marketplace-packages"));
  await mkdir(join(temp, "marketplace-packages/vscode"));
  for (const suffix of ["", ".sha256"]) {
    await copyFile(join(temp, "vscode", filename + suffix), join(temp, "marketplace-packages/vscode", filename + suffix));
  }

  for (const jobName of ["vsix", "vscode", "openvsx"]) {
    const job = workflow.jobs[jobName];
    assert.ok(job, `Missing release consumer: ${jobName}`);
    assert.equal(job.needs, jobName === "vsix" ? "build" : "vsix");
    const download = job.steps.find(s => s.uses?.startsWith("actions/download-artifact@"));
    assert.equal(download?.with.name, jobName === "vsix" ? "marketplace-packages" : "vscode-release-package");
    assert.equal(download.with.path, jobName === "vsix" ? "marketplace-packages" : "marketplace-packages/vscode");
    const step = job.steps.find(s => s.name?.startsWith("Publish "));
    assert.ok(step, `${jobName} must publish the prebuilt artifact`);
    const result = run(step);
    assert.equal(result.status, 0, result.stderr);

    const calls = (await readFile(join(temp, "calls.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
    const call = calls.at(-1);
    assert.equal(call.hash, digest(bytes), `${jobName} must receive the identical VSIX`);
    if (jobName === "vscode") assert.deepEqual(call.args.slice(0, 3), ["--no-install", "vsce", "publish"]);
    if (jobName === "openvsx") assert.deepEqual(call.args.slice(0, 3), ["--no-install", "ovsx", "publish"]);
    if (jobName === "vsix") {
      assert.deepEqual(call.args.slice(0, 3), ["release", "upload", `v${version}`]);
      assert.ok(call.args.some(a => a.endsWith(".vsix.sha256")));
    }
    // A corrupted download must fail before reaching any publishing client.
    await writeFile(join(temp, "marketplace-packages/vscode", filename), "corrupt archive");
    const rejected = run(step);
    assert.notEqual(rejected.status, 0, `${jobName} must reject a corrupt VSIX`);
    assert.equal(await readFile(join(temp, "calls.jsonl"), "utf8"), calls.map(c => JSON.stringify(c)).join("\n") + "\n");
    await writeFile(join(temp, "marketplace-packages/vscode", filename), bytes);
  }
  // A retry may rebuild different ZIP timestamps. The released VSIX remains
  // canonical, and both registries must still receive those original bytes.
  await writeFile(join(temp, "marketplace-packages/vscode", filename), "rebuilt archive");
  await writeFile(join(temp, "marketplace-packages/vscode", `${filename}.sha256`), `${digest("rebuilt archive")}  ${filename}\n`);
  const reuse = run(workflow.jobs.vsix.steps.find(s => s.name === "Publish VSIX release assets"));
  assert.equal(reuse.status, 0, reuse.stderr);
  assert.deepEqual(await readFile(join(temp, "marketplace-packages/vscode", filename)), bytes);
  for (const jobName of ["vscode", "openvsx"]) {
    const result = run(workflow.jobs[jobName].steps.find(s => s.name?.startsWith("Publish ")));
    assert.equal(result.status, 0, result.stderr);
  }
  const calls = (await readFile(join(temp, "calls.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(calls.filter(c => c.client === "gh").length, 1, "Retries must not overwrite release assets");
  assert.ok(calls.every(c => c.hash === digest(bytes)));
  await rm(join(temp, "remote", `${filename}.sha256`));
  const missingChecksum = run(workflow.jobs.vsix.steps.find(s => s.name === "Publish VSIX release assets"));
  assert.notEqual(missingChecksum.status, 0, "A released VSIX without its checksum must stop publication");
  console.log(`Publish contract passed: both marketplaces and Release receive the same ${filename}; corruption rejected`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
