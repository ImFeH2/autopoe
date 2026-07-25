import assert from "node:assert/strict";
import test from "node:test";

import {
  nativeBuildConfiguration,
  targetIdForHost,
} from "../lib/native-runtime.mjs";
import { createRuntimeResourcePlan } from "../../runtime/lib/plan.mjs";
import {
  loadTargetManifest,
  resolveTarget,
} from "../../runtime/lib/targets.mjs";

const manifest = await loadTargetManifest();

test("release runtime plans contain exactly the resources required by each target", () => {
  const linux = resolveTarget(manifest, "linux-x64");
  const windows = resolveTarget(manifest, "win32-arm64");
  const linuxPlan = createRuntimeResourcePlan(linux, "0.3.10");
  const windowsPlan = createRuntimeResourcePlan(windows, "0.3.10");

  assert.deepEqual(
    linuxPlan.resources.map((resource) => resource.name),
    ["ripgrep", "bubblewrap"],
  );
  assert.deepEqual(
    windowsPlan.resources.map((resource) => resource.name),
    ["flowent-native", "ripgrep"],
  );
  assert.equal(windowsPlan.resources[0].version, "0.3.10");
  assert.equal(windowsPlan.resources[0].source, "bin/flowent-native{exe}");
  assert.equal(windowsPlan.resources[1].sourceUrl, windows.ripgrep.archive.url);
});

test("native helper builds select the platform implementation and exact Rust target", () => {
  assert.deepEqual(
    nativeBuildConfiguration(resolveTarget(manifest, "linux-x64")),
    {
      manifest: "native/flowent-native/Cargo.toml",
      binary:
        "native/flowent-native/target/x86_64-unknown-linux-gnu/release/flowent-native",
      rustTarget: "x86_64-unknown-linux-gnu",
    },
  );
  assert.deepEqual(
    nativeBuildConfiguration(resolveTarget(manifest, "win32-arm64")),
    {
      manifest: "native/flowent-sandbox-windows/Cargo.toml",
      binary:
        "native/flowent-sandbox-windows/target/aarch64-pc-windows-msvc/release/flowent-native.exe",
      rustTarget: "aarch64-pc-windows-msvc",
    },
  );
});

test("host platform names map to release target ids", () => {
  assert.equal(targetIdForHost("linux", "x64"), "linux-x64");
  assert.equal(targetIdForHost("darwin", "arm64"), "darwin-arm64");
  assert.equal(targetIdForHost("win32", "arm64"), "win32-arm64");
  assert.throws(
    () => targetIdForHost("freebsd", "x64"),
    /Unsupported release host/,
  );
});
