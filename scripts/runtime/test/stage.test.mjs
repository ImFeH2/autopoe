import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  symlink,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import {
  loadResourcePlan,
  stageNpmPlatformPackage,
  stagePyinstallerOnedir,
  stagePythonWheelResources,
  stageRuntimeBundle,
} from "../lib/stage.mjs";

const sourceDir = new URL("./fixtures/runtime-source/", import.meta.url);
const planPath = new URL("./fixtures/runtime-plan.json", import.meta.url);
const execFileAsync = promisify(execFile);

test("runtime staging assembles binaries, licenses, and a verified resource manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowent-runtime-stage-"));
  const outputDir = join(root, "runtime");
  const plan = await loadResourcePlan(planPath);

  const result = await stageRuntimeBundle({
    targetId: "linux-x64",
    sourceDir,
    outputDir,
    resources: plan.resources,
    projectLicense: plan.projectLicense,
  });

  const manifest = JSON.parse(await readFile(result.manifestPath, "utf8"));
  assert.equal(manifest.target.id, "linux-x64");
  assert.deepEqual(Object.keys(manifest.resources), [
    "bubblewrap",
    "flowent-native",
    "ripgrep",
  ]);
  assert.equal(manifest.resources.ripgrep.path, "bin/rg");
  assert.equal(
    manifest.resources.bubblewrap.buildProvenance.path,
    "provenance/bubblewrap.json",
  );
  assert.equal(manifest.resources.ripgrep.size, 23);
  assert.match(manifest.resources.ripgrep.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(manifest.resources.ripgrep.licenses, [
    { path: "licenses/ripgrep-MIT.txt", spdx: "MIT" },
    { path: "licenses/ripgrep-UNLICENSE.txt", spdx: "Unlicense" },
  ]);
  assert.equal((await stat(join(outputDir, "bin", "rg"))).mode & 0o111, 0o111);
  assert.equal(
    await readFile(join(outputDir, "licenses", "ripgrep-MIT.txt"), "utf8"),
    "Fixture MIT license\n",
  );
  assert.equal(
    await readFile(join(outputDir, "licenses", "bubblewrap-COPYING"), "utf8"),
    "Fixture LGPL-2.0-or-later license\n",
  );
  assert.equal(
    await readFile(join(outputDir, "LICENSE"), "utf8"),
    "Apache License fixture\n",
  );
  const notices = await readFile(
    join(outputDir, "THIRD_PARTY_NOTICES"),
    "utf8",
  );
  assert.match(notices, /bubblewrap 0\.11\.0/);
  assert.match(notices, /LGPL-2\.0-or-later \(licenses\/bubblewrap-COPYING\)/);
  assert.match(
    notices,
    /Source code: https:\/\/github\.com\/containers\/bubblewrap\/tree\/v0\.11\.0/,
  );
});

test("runtime staging rejects Bubblewrap without matching static build provenance", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowent-runtime-provenance-"));
  const localSource = join(root, "source");
  const outputDir = join(root, "runtime");
  const plan = await loadResourcePlan(planPath);
  await cp(sourceDir, localSource, { recursive: true });
  const provenancePath = join(localSource, "provenance", "bubblewrap.json");
  const provenance = JSON.parse(await readFile(provenancePath, "utf8"));
  provenance.binary.sha256 = "0".repeat(64);
  await writeFile(provenancePath, JSON.stringify(provenance));

  await assert.rejects(
    stageRuntimeBundle({
      targetId: "linux-x64",
      sourceDir: localSource,
      outputDir,
      resources: plan.resources,
      projectLicense: plan.projectLicense,
    }),
    /Bubblewrap build provenance does not match the binary/,
  );
});

test("runtime staging rejects source paths that traverse a symlinked directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowent-runtime-symlink-"));
  const sourceRoot = join(root, "source");
  const outsideRoot = join(root, "outside");
  const outputDir = join(root, "runtime");
  await mkdir(sourceRoot);
  await mkdir(join(sourceRoot, "licenses"));
  await mkdir(join(outsideRoot, "bin"), { recursive: true });
  await writeFile(join(sourceRoot, "LICENSE"), "Apache License fixture\n");
  await writeFile(join(sourceRoot, "licenses", "ripgrep-MIT.txt"), "MIT\n");
  await writeFile(
    join(sourceRoot, "licenses", "ripgrep-UNLICENSE.txt"),
    "Unlicense\n",
  );
  await writeFile(join(outsideRoot, "bin", "flowent-native"), "helper\n");
  await writeFile(join(outsideRoot, "bin", "rg"), "ripgrep\n");
  await symlink(join(outsideRoot, "bin"), join(sourceRoot, "bin"), "dir");
  const resources = [
    {
      name: "flowent-native",
      source: "bin/flowent-native{exe}",
      destination: "bin/flowent-native{exe}",
      executable: true,
      version: "0.3.10",
      sourceUrl: "https://github.com/ImFeH2/flowent/releases/tag/v0.3.10",
      sourceCodeUrl: "https://github.com/ImFeH2/flowent/tree/v0.3.10",
      licenses: [
        {
          spdx: "Apache-2.0",
          source: "LICENSE",
          destination: "licenses/flowent-native-Apache-2.0.txt",
        },
      ],
    },
    {
      name: "ripgrep",
      source: "bin/rg{exe}",
      destination: "bin/rg{exe}",
      executable: true,
      version: "15.1.0",
      sourceUrl:
        "https://github.com/BurntSushi/ripgrep/releases/download/15.1.0/rg.tar.gz",
      sourceCodeUrl: "https://github.com/BurntSushi/ripgrep/tree/15.1.0",
      licenses: [
        {
          spdx: "MIT",
          source: "licenses/ripgrep-MIT.txt",
          destination: "licenses/ripgrep-MIT.txt",
        },
        {
          spdx: "Unlicense",
          source: "licenses/ripgrep-UNLICENSE.txt",
          destination: "licenses/ripgrep-UNLICENSE.txt",
        },
      ],
    },
  ];

  await assert.rejects(
    stageRuntimeBundle({
      targetId: "darwin-x64",
      sourceDir: sourceRoot,
      outputDir,
      resources,
      projectLicense: { source: "LICENSE", spdx: "Apache-2.0" },
    }),
    /source path traverses a symbolic link/,
  );
});

test("runtime staging rejects foreign absolute paths in resource plans", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowent-runtime-absolute-"));
  const plan = await loadResourcePlan(planPath);
  const resources = structuredClone(plan.resources);
  resources.find((resource) => resource.name === "ripgrep").source =
    "C:/Windows/System32/rg.exe";

  await assert.rejects(
    stageRuntimeBundle({
      targetId: "linux-x64",
      sourceDir,
      outputDir: join(root, "runtime"),
      resources,
      projectLicense: plan.projectLicense,
    }),
    /portable relative path/,
  );
});

test("npm staging emits a platform package without conflating alias and package name", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowent-runtime-npm-"));
  const plan = await loadResourcePlan(planPath);

  const result = await stageNpmPlatformPackage({
    targetId: "win32-arm64",
    sourceDir,
    outputDir: root,
    resources: plan.resources,
    projectLicense: plan.projectLicense,
    baseVersion: "0.3.10",
  });

  const packageJson = JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
  );
  assert.equal(result.alias, "flowent-win32-arm64");
  assert.equal(result.dependency, "npm:flowent@0.3.10-win32-arm64");
  assert.equal(packageJson.name, "flowent");
  assert.equal(packageJson.version, "0.3.10-win32-arm64");
  assert.deepEqual(packageJson.os, ["win32"]);
  assert.deepEqual(packageJson.cpu, ["arm64"]);
  assert.equal(
    JSON.parse(
      await readFile(
        join(root, "vendor", "aarch64-pc-windows-msvc", "resources.json"),
        "utf8",
      ),
    ).target.id,
    "win32-arm64",
  );
  assert.equal(
    JSON.parse(
      await readFile(
        join(root, "vendor", "aarch64-pc-windows-msvc", "resources.json"),
        "utf8",
      ),
    ).resources.bubblewrap,
    undefined,
  );
  assert.equal(
    await readFile(join(root, "LICENSE"), "utf8"),
    "Apache License fixture\n",
  );
  assert.match(
    await readFile(join(root, "THIRD_PARTY_NOTICES"), "utf8"),
    /ripgrep 15\.1\.0/,
  );
});

test("PyInstaller staging describes reusable onedir binary and data inputs", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowent-runtime-pyinstaller-"));
  const plan = await loadResourcePlan(planPath);

  const result = await stagePyinstallerOnedir({
    targetId: "linux-x64",
    sourceDir,
    outputDir: root,
    resources: plan.resources,
    projectLicense: plan.projectLicense,
  });

  const input = JSON.parse(await readFile(result.inputPath, "utf8"));
  assert.deepEqual(input.binaries, []);
  assert.deepEqual(
    input.data.map((entry) => entry.source).sort(),
    [
      "flowent-runtime/LICENSE",
      "flowent-runtime/THIRD_PARTY_NOTICES",
      "flowent-runtime/bin/bwrap",
      "flowent-runtime/bin/flowent-native",
      "flowent-runtime/bin/rg",
      "flowent-runtime/licenses/bubblewrap-COPYING",
      "flowent-runtime/licenses/flowent-native-Apache-2.0.txt",
      "flowent-runtime/licenses/ripgrep-MIT.txt",
      "flowent-runtime/licenses/ripgrep-UNLICENSE.txt",
      "flowent-runtime/provenance/bubblewrap.json",
      "flowent-runtime/resources.json",
    ].sort(),
  );
});

test("Python wheel staging uses the companion package runtime directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowent-runtime-python-"));
  const plan = await loadResourcePlan(planPath);

  const result = await stagePythonWheelResources({
    targetId: "darwin-arm64",
    sourceDir,
    packageRoot: root,
    resources: plan.resources,
    projectLicense: plan.projectLicense,
  });

  assert.equal(
    result.bundleRoot,
    join(root, "python", "flowent_native", "runtime"),
  );
  assert.equal(
    JSON.parse(await readFile(result.manifestPath, "utf8")).target.id,
    "darwin-arm64",
  );
  assert.equal(
    await readFile(join(result.bundleRoot, "LICENSE"), "utf8"),
    "Apache License fixture\n",
  );
});

test("packed npm platform artifact retains all project and component notices", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "flowent-runtime-pack-"));
  const stageRoot = join(root, "stage");
  const unpackRoot = join(root, "unpacked");
  const plan = await loadResourcePlan(planPath);

  await stageNpmPlatformPackage({
    targetId: "linux-x64",
    sourceDir,
    outputDir: stageRoot,
    resources: plan.resources,
    projectLicense: plan.projectLicense,
    baseVersion: "0.3.10",
  });
  await mkdir(unpackRoot);
  let packed;
  try {
    packed = JSON.parse(
      (
        await execFileAsync("npm", ["pack", "--json"], {
          cwd: stageRoot,
          env: {
            ...process.env,
            npm_config_cache: join(root, "npm-cache"),
          },
        })
      ).stdout,
    )[0];
    await execFileAsync(
      "tar",
      ["-xzf", join(stageRoot, packed.filename), "-C", unpackRoot],
      { cwd: stageRoot },
    );
  } catch (error) {
    if (error?.code === "ENOENT") {
      context.skip("npm or tar is unavailable");
      return;
    }
    throw error;
  }

  const packageRoot = join(unpackRoot, "package");
  const runtimeRoot = join(packageRoot, "vendor", "x86_64-unknown-linux-gnu");
  assert.equal(
    JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")).libc,
    "glibc",
  );
  assert.equal(
    await readFile(join(packageRoot, "LICENSE"), "utf8"),
    "Apache License fixture\n",
  );
  assert.match(
    await readFile(join(packageRoot, "THIRD_PARTY_NOTICES"), "utf8"),
    /bubblewrap 0\.11\.0/,
  );
  assert.equal(
    await readFile(join(runtimeRoot, "licenses", "bubblewrap-COPYING"), "utf8"),
    "Fixture LGPL-2.0-or-later license\n",
  );
  assert.equal(
    await readFile(join(runtimeRoot, "licenses", "ripgrep-MIT.txt"), "utf8"),
    "Fixture MIT license\n",
  );
  assert.equal(
    JSON.parse(
      await readFile(
        join(runtimeRoot, "provenance", "bubblewrap.json"),
        "utf8",
      ),
    ).static,
    true,
  );
});
