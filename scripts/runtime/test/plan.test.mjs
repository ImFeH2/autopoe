import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import {
  createRuntimeResourcePlan,
  writeRuntimeResourcePlan,
} from "../lib/plan.mjs";
import { loadResourcePlan } from "../lib/stage.mjs";
import { loadTargetManifest } from "../lib/targets.mjs";

const execFileAsync = promisify(execFile);

test("formal resource plans match every pinned release target", async () => {
  const manifest = await loadTargetManifest();
  const root = await mkdtemp(join(tmpdir(), "flowent-runtime-plan-"));

  for (const target of Object.values(manifest.targets)) {
    const plan = createRuntimeResourcePlan(target, "0.3.10");
    const names = plan.resources.map((resource) => resource.name).sort();
    assert.deepEqual(names, [...target.requiredResources].sort());
    assert.equal(
      plan.resources.some((resource) => resource.name === "flowent-native"),
      target.os === "win32",
    );
    if (target.os === "win32") {
      assert.equal(plan.resources[0].version, "0.3.10");
    }
    assert.equal(
      plan.resources.find((resource) => resource.name === "ripgrep").sourceUrl,
      target.ripgrep.archive.url,
    );
    const planPath = join(root, `${target.id}.json`);
    await writeFile(planPath, JSON.stringify(plan), "utf8");
    assert.deepEqual(await loadResourcePlan(planPath), plan);
  }
});

test("formal resource plan versions cannot alter release source paths", async () => {
  const manifest = await loadTargetManifest();
  const target = manifest.targets["linux-x64"];

  assert.throws(
    () => createRuntimeResourcePlan(target, "../../outside"),
    /valid semantic version/,
  );
});

test("resource plan writer creates a new validated plan without overwriting files", async () => {
  const manifest = await loadTargetManifest();
  const root = await mkdtemp(join(tmpdir(), "flowent-runtime-plan-"));
  const outputPath = join(root, "runtime-plan.json");
  const result = await writeRuntimeResourcePlan({
    target: manifest.targets["darwin-arm64"],
    version: "0.3.10",
    outputPath,
  });

  assert.equal(result.outputPath, outputPath);
  assert.deepEqual(await loadResourcePlan(outputPath), result.plan);
  await assert.rejects(
    writeRuntimeResourcePlan({
      target: manifest.targets["darwin-arm64"],
      version: "0.3.10",
      outputPath,
    }),
    /EEXIST/,
  );
});

test("resource plan CLI emits the stable package-runtime input", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowent-runtime-plan-cli-"));
  const outputPath = join(root, "runtime-plan.json");
  const script = new URL("../create-plan.mjs", import.meta.url);
  const result = await execFileAsync(process.execPath, [
    script.pathname,
    "--target",
    "win32-x64",
    "--version",
    "0.3.10",
    "--output",
    outputPath,
  ]);

  assert.equal(result.stdout.trim(), outputPath);
  const plan = JSON.parse(await readFile(outputPath, "utf8"));
  assert.deepEqual(
    plan.resources.map((resource) => resource.name),
    ["flowent-native", "ripgrep"],
  );
});
