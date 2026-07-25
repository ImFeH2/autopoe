import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const projectRoot = join(import.meta.dirname, "..", "..", "..");

async function read(relativePath) {
  return readFile(join(projectRoot, relativePath), "utf8");
}

test("release manifests use one version and a reproducible native dependency", async () => {
  const [
    packageJson,
    backendProject,
    backendLock,
    nativeProject,
    nativeCargo,
    nativeLock,
    windowsCargo,
    windowsLock,
  ] = await Promise.all([
    read("package.json").then(JSON.parse),
    read("backend/pyproject.toml"),
    read("backend/uv.lock"),
    read("native/flowent-native/pyproject.toml"),
    read("native/flowent-native/Cargo.toml"),
    read("native/flowent-native/Cargo.lock"),
    read("native/flowent-sandbox-windows/Cargo.toml"),
    read("native/flowent-sandbox-windows/Cargo.lock"),
  ]);
  const version = packageJson.version;
  assert.equal(typeof version, "string");
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  assert.match(
    backendProject,
    new RegExp(`^version = "${escapedVersion}"$`, "m"),
  );
  assert.match(
    backendProject,
    new RegExp(`^ {4}"flowent-native==${escapedVersion}",$`, "m"),
  );
  assert.match(
    backendProject,
    /^flowent-native = \{ path = "\.\.\/native\/flowent-native" \}$/m,
  );
  assert.match(backendProject, /^ {4}"pyinstaller>=6\.14\.1,<7\.0\.0",$/m);
  assert.match(backendLock, /name = "flowent-native"/);
  assert.match(nativeProject, /^module-name = "flowent_native"$/m);
  assert.match(nativeCargo, new RegExp(`^version = "${escapedVersion}"$`, "m"));
  assert.match(
    nativeLock,
    new RegExp(`name = "flowent-native"\\nversion = "${escapedVersion}"`),
  );
  assert.match(
    windowsCargo,
    new RegExp(`^version = "${escapedVersion}"$`, "m"),
  );
  assert.match(
    windowsLock,
    new RegExp(
      `name = "flowent-sandbox-windows"\\nversion = "${escapedVersion}"`,
    ),
  );
});

test("npm packaging uses the staged runtime package commands", async () => {
  const packageJson = JSON.parse(await read("package.json"));

  assert.equal(packageJson.private, true);
  assert.equal(packageJson.scripts.prepack, undefined);
  assert.equal(
    packageJson.scripts["package:npm:main"],
    "node scripts/package-runtime/stage-main-package.mjs --output dist/npm/flowent",
  );
  assert.equal(
    packageJson.scripts["package:npm:platform"],
    "node scripts/package-runtime/build-platform-package.mjs",
  );
  assert.equal(
    packageJson.scripts["test:package-runtime"],
    "node --test scripts/package-runtime/test/*.test.mjs",
  );
  assert.equal(
    packageJson.scripts["test:runtime"],
    "node --test scripts/runtime/test/*.test.mjs",
  );
  assert.equal(
    packageJson.scripts["test:release"],
    "node --test scripts/release/test/*.test.mjs",
  );
  assert.match(packageJson.scripts.test, /pnpm test:runtime/);
  assert.match(packageJson.scripts.test, /pnpm test:release/);
  assert.doesNotMatch(
    JSON.stringify(packageJson.scripts),
    /prepare-npm-package/,
  );
  assert.doesNotMatch(packageJson.scripts["package:npm:platform"], /\buv\b/);
});

test("release workflows publish from exact tags and gate the GitHub release", async () => {
  const [npmWorkflow, pypiWorkflow, dockerWorkflow, releaseWorkflow] =
    await Promise.all([
      read(".github/workflows/npm-publish.yml"),
      read(".github/workflows/pypi-publish.yml"),
      read(".github/workflows/docker-publish.yml"),
      read(".github/workflows/release.yml"),
    ]);

  for (const workflow of [npmWorkflow, pypiWorkflow, dockerWorkflow]) {
    assert.match(workflow, /^ {2}push:\n {4}tags:\n {6}- "v\*"$/m);
    assert.match(workflow, /ref: refs\/tags\/\$\{\{[^\n]+\}\}/);
    assert.match(workflow, /^run-name: .+\$\{\{[^\n]+inputs\.tag[^\n]+\}\}$/m);
  }

  assert.doesNotMatch(pypiWorkflow, /skip-existing: true/);
  assert.match(pypiWorkflow, /prepare_pypi_publish\.py/);
  assert.match(pypiWorkflow, /steps\.preflight\.outputs\.remaining/);
  assert.match(pypiWorkflow, /node-version: 24\.15\.0/);
  assert.match(pypiWorkflow, /python-version: "3\.13\.13"/);
  assert.match(pypiWorkflow, /^ {6}SOURCE_DATE_EPOCH: 315532800$/m);
  assert.match(pypiWorkflow, /^ {10}version: "0\.8\.14"$/m);
  assert.match(npmWorkflow, /node scripts\/release\/publish-npm-package\.mjs/);
  assert.match(npmWorkflow, /node-version: 24\.15\.0/);
  assert.match(dockerWorkflow, /python scripts\/release\/check_versions\.py/);
  assert.match(
    dockerWorkflow,
    /python scripts\/release\/select_docker_latest\.py/,
  );
  assert.match(
    dockerWorkflow,
    /type=raw,value=latest,enable=\$\{\{ steps\.version\.outputs\.latest == 'true' \}\}/,
  );
  assert.match(releaseWorkflow, /^ {2}actions: write$/m);
  assert.match(releaseWorkflow, /npm-publish\.yml/);
  assert.match(releaseWorkflow, /pypi-publish\.yml/);
  assert.match(releaseWorkflow, /docker-publish\.yml/);
  assert.match(releaseWorkflow, /head_sha/);
  assert.match(releaseWorkflow, /event=/);
  assert.match(releaseWorkflow, /display_title/);
  assert.match(releaseWorkflow, /gh workflow run/);
  assert.match(releaseWorkflow, /minimum_ids/);
  assert.match(releaseWorkflow, /\.id > \$before/);
  assert.match(releaseWorkflow, /RELEASE_TAG/);
  assert.match(releaseWorkflow, /conclusion/);
  assert.match(releaseWorkflow, /gh release create/);
});

test("workflow actions use immutable commit references", async () => {
  const workflows = await Promise.all(
    [
      "ci.yml",
      "native-build.yml",
      "npm-publish.yml",
      "pypi-publish.yml",
      "docker-publish.yml",
      "release.yml",
    ].map((name) => read(`.github/workflows/${name}`)),
  );

  for (const workflow of workflows) {
    for (const line of workflow.matchAll(/^\s+uses: ([^\s]+)$/gm)) {
      if (line[1].startsWith("./")) {
        continue;
      }
      assert.match(line[1], /^[^@]+@[a-f0-9]{40}$/);
    }
  }
});

test("release configuration updates every version source", async () => {
  const release = JSON.parse(await read(".release-it.json"));
  const outputs = release.plugins["@release-it/bumper"].out;

  assert.deepEqual(
    outputs.map((output) => output.file),
    [
      "backend/pyproject.toml",
      "native/flowent-native/Cargo.toml",
      "native/flowent-sandbox-windows/Cargo.toml",
      "native/flowent-native/Cargo.lock",
      "native/flowent-sandbox-windows/Cargo.lock",
    ],
  );
  assert.deepEqual(release.hooks["after:bump"], [
    "uv lock --project backend",
    "python scripts/release/check_versions.py",
  ]);
});

test("Linux applications freeze in the matching manylinux 2_17 container", async () => {
  const workflow = await read(".github/workflows/native-build.yml");

  assert.match(
    workflow,
    /target: linux-x64[\s\S]*manylinux_container: quay\.io\/pypa\/manylinux2014_x86_64@sha256:[a-f0-9]{64}/,
  );
  assert.match(
    workflow,
    /target: linux-arm64[\s\S]*manylinux_container: quay\.io\/pypa\/manylinux2014_aarch64@sha256:[a-f0-9]{64}/,
  );
  assert.match(
    workflow,
    /target: linux-x64[\s\S]*freeze_container: ghcr\.io\/pyo3\/maturin@sha256:[a-f0-9]{64}/,
  );
  assert.match(
    workflow,
    /target: linux-arm64[\s\S]*freeze_container: ghcr\.io\/pyo3\/maturin@sha256:[a-f0-9]{64}/,
  );
  assert.match(workflow, /uv export --project backend --frozen --no-dev/);
  assert.match(workflow, /--only-group native-build/);
  assert.match(workflow, /pip install[^\n]*--require-hashes/);
  assert.match(workflow, /uv python install 3\.13\.13/);
  assert.match(workflow, /uv venv --python 3\.13\.13/);
  assert.match(workflow, /node-version: 24\.15\.0/);
  assert.match(workflow, /python-version: "3\.13\.13"/);
  assert.match(workflow, /^ {6}SOURCE_DATE_EPOCH: 315532800$/m);
  assert.match(workflow, /^ {10}version: "0\.8\.14"$/m);
  assert.match(workflow, /rustup toolchain install 1\.93\.1/);
  assert.match(workflow, /rustup default 1\.93\.1/);
  assert.doesNotMatch(workflow, /rustup (?:toolchain install|default) stable/);
  assert.match(
    workflow,
    /docker-options: -e SOURCE_DATE_EPOCH -e PYTHONHASHSEED/,
  );
  assert.match(workflow, /rust-toolchain: "1\.93\.1"/);
  assert.match(
    workflow,
    /name: Download frontend files[\s\S]*name: Prepare Python package[\s\S]*node scripts\/prepare-python-readme\.mjs[\s\S]*name: Install Python build dependencies/,
  );
  assert.match(
    workflow,
    /name: Stage frozen application inputs[\s\S]*if: matrix\.platform == 'linux'[\s\S]*stage-pyinstaller-input\.mjs/,
  );
  assert.match(
    workflow,
    /name: Build Linux frozen application[\s\S]*if: matrix\.platform == 'linux'[\s\S]*docker run[\s\S]*\$\{\{ matrix\.freeze_container \}\}[\s\S]*scripts\/package-runtime\/freeze\.py/,
  );
  assert.match(
    workflow,
    /name: Build platform npm package[\s\S]*if: matrix\.platform != 'linux'/,
  );
  assert.match(
    workflow,
    /name: Stage Linux platform npm package[\s\S]*if: matrix\.platform == 'linux'[\s\S]*--application \.artifacts\/work\/application\/flowent/,
  );
  assert.match(
    workflow,
    /name: Verify native artifacts[\s\S]*--application "\$\{\{ matrix\.application \}\}"[\s\S]*--npm-dir \.artifacts\/dist\/npm[\s\S]*--wheel-dir \.artifacts\/dist\/python/,
  );
  assert.match(
    workflow,
    /name: Probe native command protection[\s\S]*FLOWENT_DATA_DIR:[\s\S]*probe_command_protection\.py/,
  );
  assert.doesNotMatch(
    workflow,
    /name: Probe native command protection\n\s+if:/,
  );
  assert.match(
    workflow,
    /name: Check frozen application[\s\S]*FLOWENT_DATA_DIR:[\s\S]*doctor[\s\S]*matrix\.application/,
  );
});
