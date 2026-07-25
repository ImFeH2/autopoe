import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildPyinstallerOnedir } from "../lib/pyinstaller.mjs";

const projectRoot = join(import.meta.dirname, "..", "..", "..");

async function runtimeInput(root) {
  const stagingRoot = join(root, "runtime-stage");
  await mkdir(join(stagingRoot, "flowent-runtime", "bin"), {
    recursive: true,
  });
  await writeFile(join(stagingRoot, "flowent-runtime", "bin", "rg"), "fixture");
  await writeFile(join(stagingRoot, "flowent-runtime", "resources.json"), "{}");
  const inputPath = join(stagingRoot, "pyinstaller-input.json");
  await writeFile(
    inputPath,
    JSON.stringify({
      schemaVersion: 1,
      target: "linux-x64",
      bundleDirectory: "flowent-runtime",
      binaries: [
        {
          source: "flowent-runtime/bin/rg",
          destination: "flowent-runtime/bin",
        },
      ],
      data: [
        {
          source: "flowent-runtime/resources.json",
          destination: "flowent-runtime",
        },
      ],
    }),
  );
  return inputPath;
}

test("PyInstaller build delegates the complete freeze contract to Python", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowent-pyinstaller-build-"));
  const inputPath = await runtimeInput(root);
  let invocation;

  const result = await buildPyinstallerOnedir({
    targetId: "linux-x64",
    platform: "linux",
    arch: "x64",
    projectRoot,
    inputPath,
    outputDir: join(root, "dist"),
    workDir: join(root, "build"),
    specDir: join(root, "spec"),
    pythonCommand: "python-fixture",
    async run(command, args, options) {
      invocation = { command, args, options };
      const applicationDir = join(root, "dist", "flowent");
      await mkdir(applicationDir, { recursive: true });
      await writeFile(join(applicationDir, "flowent"), "fixture");
    },
  });

  assert.equal(invocation.command, "python-fixture");
  assert.deepEqual(invocation.args, [
    join(projectRoot, "scripts", "package-runtime", "freeze.py"),
    "--project-root",
    projectRoot,
    "--input",
    inputPath,
    "--output",
    join(root, "dist"),
    "--work",
    join(root, "build"),
    "--spec",
    join(root, "spec"),
  ]);
  assert.equal(invocation.options.cwd, projectRoot);
  assert.equal(invocation.options.env.PYTHONHASHSEED, "0");
  assert.equal(invocation.options.env.PYTHONDONTWRITEBYTECODE, "1");
  assert.equal(invocation.options.env.SOURCE_DATE_EPOCH, "0");
  assert.equal(result.applicationDir, join(root, "dist", "flowent"));
});
