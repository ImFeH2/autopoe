import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  loadTargetManifest,
  npmPackageMetadata,
  resolveCurrentTarget,
} from "../lib/targets.mjs";

const expectedTargets = [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "win32-arm64",
  "win32-x64",
];

test("target manifest fixes the supported operating system and architecture matrix", async () => {
  const manifest = await loadTargetManifest();

  assert.deepEqual(Object.keys(manifest.targets).sort(), expectedTargets);
  for (const [targetId, target] of Object.entries(manifest.targets)) {
    assert.equal(target.id, targetId);
    assert.match(target.rustTarget, /^(aarch64|x86_64)-/);
    assert.match(target.python.wheelPlatform, /^(manylinux|macosx|win_)/);
    assert.equal(target.npm.alias, `flowent-${targetId}`);
    assert.equal(target.npm.name, "flowent");
    assert.equal(target.npm.versionTag, targetId);
    assert.equal(
      target.requiredResources.includes("flowent-native"),
      target.os === "win32",
    );
    assert.equal(target.requiredResources.includes("ripgrep"), true);
    if (target.os === "linux") {
      assert.equal(target.npm.libc, "glibc");
      assert.equal(target.requiredResources.includes("bubblewrap"), true);
      assert.equal(target.bubblewrap.version, "0.11.0");
      assert.equal(target.bubblewrap.licenseSpdx, "LGPL-2.0-or-later");
      assert.equal(target.bubblewrap.licensePath, "COPYING");
      assert.equal(target.bubblewrap.archive.size, 115228);
      assert.equal(
        target.bubblewrap.archive.sha256,
        "988fd6b232dafa04b8b8198723efeaccdb3c6aa9c1c7936219d5791a8b7a8646",
      );
      assert.match(
        target.bubblewrap.sourceCodeUrl,
        /^https:\/\/github\.com\/containers\/bubblewrap\//,
      );
    } else {
      assert.equal(target.npm.libc, undefined);
    }
  }
});

test("target manifest pins verified ripgrep release artifacts", async () => {
  const manifest = await loadTargetManifest();
  const expected = {
    "darwin-arm64": [
      1777930,
      "378e973289176ca0c6054054ee7f631a065874a352bf43f0fa60ef079b6ba715",
    ],
    "darwin-x64": [
      1894127,
      "64811cb24e77cac3057d6c40b63ac9becf9082eedd54ca411b475b755d334882",
    ],
    "linux-arm64": [
      1869959,
      "2b661c6ef508e902f388e9098d9c4c5aca72c87b55922d94abdba830b4dc885e",
    ],
    "linux-x64": [
      2263077,
      "1c9297be4a084eea7ecaedf93eb03d058d6faae29bbc57ecdaf5063921491599",
    ],
    "win32-arm64": [
      1675460,
      "00d931fb5237c9696ca49308818edb76d8eb6fc132761cb2a1bd616b2df02f8e",
    ],
    "win32-x64": [
      1810687,
      "124510b94b6baa3380d051fdf4650eaa80a302c876d611e9dba0b2e18d87493a",
    ],
  };

  for (const [targetId, [size, sha256]] of Object.entries(expected)) {
    const ripgrep = manifest.targets[targetId].ripgrep;
    assert.equal(ripgrep.version, "15.1.0");
    assert.equal(ripgrep.archive.size, size);
    assert.equal(ripgrep.archive.sha256, sha256);
    assert.match(
      ripgrep.archive.url,
      /^https:\/\/github\.com\/BurntSushi\/ripgrep\//,
    );
  }
});

test("current target and npm package metadata use separate platform aliases", async () => {
  const manifest = await loadTargetManifest();
  const target = resolveCurrentTarget(manifest, "linux", "x64");
  const metadata = npmPackageMetadata(target, "0.3.10");

  assert.equal(target.id, "linux-x64");
  assert.deepEqual(metadata, {
    alias: "flowent-linux-x64",
    name: "flowent",
    version: "0.3.10-linux-x64",
    dependency: "npm:flowent@0.3.10-linux-x64",
    os: ["linux"],
    cpu: ["x64"],
    libc: "glibc",
  });
});

test("target manifests reject archive paths that escape the extraction root", async () => {
  const manifest = await loadTargetManifest();
  const root = await mkdtemp(join(tmpdir(), "flowent-runtime-targets-"));
  const manifestPath = join(root, "targets.json");
  manifest.targets["linux-x64"].ripgrep.binaryPath = "../../rg";
  await writeFile(manifestPath, JSON.stringify(manifest), "utf8");

  await assert.rejects(
    loadTargetManifest(manifestPath),
    /ripgrep binary path escapes its root/,
  );
});

test("target manifests reject platform paths with foreign absolute syntax", async () => {
  const manifest = await loadTargetManifest();
  const root = await mkdtemp(join(tmpdir(), "flowent-runtime-targets-"));
  const manifestPath = join(root, "targets.json");
  manifest.targets["win32-x64"].ripgrep.licensePaths[0] = "C:/LICENSE";
  await writeFile(manifestPath, JSON.stringify(manifest), "utf8");

  await assert.rejects(
    loadTargetManifest(manifestPath),
    /ripgrep license path must use a portable relative path/,
  );
});

test("target manifests reject Rust target paths that could escape staging", async () => {
  const manifest = await loadTargetManifest();
  const root = await mkdtemp(join(tmpdir(), "flowent-runtime-targets-"));
  const manifestPath = join(root, "targets.json");
  manifest.targets["darwin-arm64"].rustTarget = "../../outside";
  await writeFile(manifestPath, JSON.stringify(manifest), "utf8");

  await assert.rejects(loadTargetManifest(manifestPath), /invalid Rust target/);
});
