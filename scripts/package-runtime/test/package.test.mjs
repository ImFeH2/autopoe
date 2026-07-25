import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { stageMainPackage, stagePlatformPackage } from "../lib/package.mjs";

const execFileAsync = promisify(execFile);
const projectRoot = join(import.meta.dirname, "..", "..", "..");
const runtimeSource = join(
  projectRoot,
  "scripts",
  "runtime",
  "test",
  "fixtures",
  "runtime-source",
);
const runtimePlan = join(
  projectRoot,
  "scripts",
  "runtime",
  "test",
  "fixtures",
  "runtime-plan.json",
);

test("staged main npm package injects all platform aliases", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowent-main-package-"));
  await stageMainPackage({ projectRoot, outputDir: root });

  const sourcePackage = JSON.parse(
    await readFile(join(projectRoot, "package.json"), "utf8"),
  );
  const packageJson = JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
  );
  assert.equal(packageJson.version, sourcePackage.version);
  assert.deepEqual(packageJson.optionalDependencies, {
    "flowent-darwin-arm64": `npm:flowent@${sourcePackage.version}-darwin-arm64`,
    "flowent-darwin-x64": `npm:flowent@${sourcePackage.version}-darwin-x64`,
    "flowent-linux-arm64": `npm:flowent@${sourcePackage.version}-linux-arm64`,
    "flowent-linux-x64": `npm:flowent@${sourcePackage.version}-linux-x64`,
    "flowent-win32-arm64": `npm:flowent@${sourcePackage.version}-win32-arm64`,
    "flowent-win32-x64": `npm:flowent@${sourcePackage.version}-win32-x64`,
  });
  assert.equal(packageJson.scripts, undefined);
  assert.equal(packageJson.devDependencies, undefined);
  assert.deepEqual(packageJson.files, [
    "bin/",
    "README.md",
    "README.zh-CN.md",
    "LICENSE",
    "THIRD_PARTY_NOTICES",
  ]);
  assert.match(
    await readFile(join(root, "bin", "flowent.mjs"), "utf8"),
    /resolveInstalledRuntime/,
  );
  assert.equal(
    (await stat(join(root, "bin", "flowent.mjs"))).mode & 0o111,
    0o111,
  );
  assert.match(await readFile(join(root, "LICENSE"), "utf8"), /Apache License/);
  assert.match(
    await readFile(join(root, "THIRD_PARTY_NOTICES"), "utf8"),
    /does not bundle third-party components/i,
  );
});

test("packed main npm artifact contains aliases, launcher, license, and notices", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowent-main-pack-"));
  const stageRoot = join(root, "stage");
  const unpackRoot = join(root, "unpacked");
  await stageMainPackage({ projectRoot, outputDir: stageRoot });
  await mkdir(unpackRoot);
  const packed = JSON.parse(
    (
      await execFileAsync("npm", ["pack", "--json"], {
        cwd: stageRoot,
        env: { ...process.env, npm_config_cache: join(root, "npm-cache") },
      })
    ).stdout,
  )[0];
  await execFileAsync("tar", [
    "-xzf",
    join(stageRoot, packed.filename),
    "-C",
    unpackRoot,
  ]);

  const unpacked = join(unpackRoot, "package");
  const packageJson = JSON.parse(
    await readFile(join(unpacked, "package.json"), "utf8"),
  );
  assert.equal(Object.keys(packageJson.optionalDependencies).length, 6);
  assert.equal(packageJson.bin.flowent, "bin/flowent.mjs");
  assert.match(await readFile(join(unpacked, "LICENSE"), "utf8"), /Apache/);
  assert.match(
    await readFile(join(unpacked, "THIRD_PARTY_NOTICES"), "utf8"),
    /Third-Party Notices/,
  );
  assert.equal(
    (await readFile(join(unpacked, "bin", "flowent.mjs"), "utf8")).length > 0,
    true,
  );
  assert.equal(
    (await stat(join(unpacked, "bin", "flowent.mjs"))).mode & 0o111,
    0o111,
  );

  await assert.rejects(
    execFileAsync(process.execPath, [
      join(unpacked, "bin", "flowent.mjs"),
      "doctor",
    ]),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /files for this computer are missing/i);
      return true;
    },
  );
});

test("staged platform npm package includes the frozen application and notices", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowent-platform-package-"));
  const applicationDir = join(root, "application", "flowent");
  const outputDir = join(root, "package");
  const binaryPath = join(applicationDir, "flowent");
  await mkdir(dirname(binaryPath), { recursive: true });
  await writeFile(binaryPath, "frozen application fixture");
  await chmod(binaryPath, 0o755);
  await writeFile(join(applicationDir, "python-library.zip"), "fixture");

  const result = await stagePlatformPackage({
    targetId: "linux-x64",
    sourceDir: runtimeSource,
    planPath: runtimePlan,
    applicationDir,
    outputDir,
    baseVersion: "0.3.10",
  });

  assert.equal(result.alias, "flowent-linux-x64");
  assert.equal(
    JSON.parse(await readFile(join(outputDir, "package.json"), "utf8")).libc,
    "glibc",
  );
  assert.equal(
    await readFile(
      join(
        outputDir,
        "vendor",
        "x86_64-unknown-linux-gnu",
        "flowent",
        "flowent",
      ),
      "utf8",
    ),
    "frozen application fixture",
  );
  assert.match(
    await readFile(join(outputDir, "THIRD_PARTY_NOTICES"), "utf8"),
    /ripgrep 15\.1\.0/,
  );
  assert.deepEqual((await readdir(outputDir)).sort(), [
    "LICENSE",
    "THIRD_PARTY_NOTICES",
    "package.json",
    "vendor",
  ]);
});

test("packed POSIX platform npm package materializes frozen application links", {
  skip: process.platform === "win32",
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "flowent-platform-link-"));
  const applicationDir = join(root, "application", "flowent");
  const outputDir = join(root, "package");
  const binaryPath = join(applicationDir, "flowent");
  await mkdir(dirname(binaryPath), { recursive: true });
  await writeFile(binaryPath, "frozen application fixture");
  await chmod(binaryPath, 0o755);
  await writeFile(join(applicationDir, "python-library.zip"), "fixture");
  await symlink(
    "python-library.zip",
    join(applicationDir, "python-library-link.zip"),
  );

  await stagePlatformPackage({
    targetId: "linux-x64",
    sourceDir: runtimeSource,
    planPath: runtimePlan,
    applicationDir,
    outputDir,
    baseVersion: "0.3.10",
  });

  const copiedLink = await lstat(
    join(
      outputDir,
      "vendor",
      "x86_64-unknown-linux-gnu",
      "flowent",
      "python-library-link.zip",
    ),
  );
  assert.equal(copiedLink.isFile(), true);
  assert.equal(copiedLink.isSymbolicLink(), false);

  const unpackRoot = join(root, "unpacked");
  await mkdir(unpackRoot);
  const packed = JSON.parse(
    (
      await execFileAsync("npm", ["pack", "--json"], {
        cwd: outputDir,
        env: { ...process.env, npm_config_cache: join(root, "npm-cache") },
      })
    ).stdout,
  )[0];
  await execFileAsync("tar", [
    "-xzf",
    join(outputDir, packed.filename),
    "-C",
    unpackRoot,
  ]);
  assert.equal(
    await readFile(
      join(
        unpackRoot,
        "package",
        "vendor",
        "x86_64-unknown-linux-gnu",
        "flowent",
        "python-library-link.zip",
      ),
      "utf8",
    ),
    "fixture",
  );
});
