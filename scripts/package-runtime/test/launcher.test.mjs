import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  access,
  chmod,
  link,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import test from "node:test";

import {
  resolveInstalledRuntime,
  resolveRuntimeTarget,
  runRuntime,
} from "../../../bin/flowent.mjs";

const targets = {
  "darwin-arm64": [
    "flowent-darwin-arm64",
    "aarch64-apple-darwin",
    "flowent",
    undefined,
  ],
  "darwin-x64": [
    "flowent-darwin-x64",
    "x86_64-apple-darwin",
    "flowent",
    undefined,
  ],
  "linux-arm64": [
    "flowent-linux-arm64",
    "aarch64-unknown-linux-gnu",
    "flowent",
    "glibc",
  ],
  "linux-x64": [
    "flowent-linux-x64",
    "x86_64-unknown-linux-gnu",
    "flowent",
    "glibc",
  ],
  "win32-arm64": [
    "flowent-win32-arm64",
    "aarch64-pc-windows-msvc",
    "flowent.exe",
    undefined,
  ],
  "win32-x64": [
    "flowent-win32-x64",
    "x86_64-pc-windows-msvc",
    "flowent.exe",
    undefined,
  ],
};

test("launcher maps the six supported operating system targets", () => {
  for (const [
    targetId,
    [alias, rustTarget, binaryName, libc],
  ] of Object.entries(targets)) {
    const [platform, arch] = targetId.split("-");
    assert.deepEqual(resolveRuntimeTarget(platform, arch), {
      id: targetId,
      alias,
      rustTarget,
      binaryName,
      ...(libc ? { libc } : {}),
    });
  }
});

test("launcher rejects unsupported operating systems and architectures", () => {
  assert.throws(
    () => resolveRuntimeTarget("freebsd", "x64"),
    /not available for freebsd x64/i,
  );
  assert.throws(
    () => resolveRuntimeTarget("linux", "riscv64"),
    /not available for linux riscv64/i,
  );
});

test("launcher fails closed when the platform package is missing", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowent-launcher-missing-"));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "flowent", version: "0.3.10" }),
  );

  await assert.rejects(
    resolveInstalledRuntime({
      packageRoot: root,
      platform: "linux",
      arch: "x64",
      resolvePackageJson() {
        throw Object.assign(new Error("not found"), {
          code: "MODULE_NOT_FOUND",
        });
      },
    }),
    /files for this computer are missing/i,
  );
});

test("launcher rejects mismatched or damaged platform files", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowent-launcher-damaged-"));
  const platformRoot = join(root, "node_modules", "flowent-linux-x64");
  const packageJsonPath = join(platformRoot, "package.json");
  await mkdir(platformRoot, { recursive: true });
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "flowent", version: "0.3.10" }),
  );
  await writeFile(
    packageJsonPath,
    JSON.stringify({
      name: "flowent",
      version: "0.3.9-linux-x64",
      os: ["linux"],
      cpu: ["x64"],
    }),
  );

  await assert.rejects(
    resolveInstalledRuntime({
      packageRoot: root,
      platform: "linux",
      arch: "x64",
      resolvePackageJson: () => packageJsonPath,
    }),
    /incomplete or damaged/i,
  );

  await writeFile(
    packageJsonPath,
    JSON.stringify({
      name: "flowent",
      version: "0.3.10-linux-x64",
      os: ["linux"],
      cpu: ["x64"],
    }),
  );

  await assert.rejects(
    resolveInstalledRuntime({
      packageRoot: root,
      platform: "linux",
      arch: "x64",
      resolvePackageJson: () => packageJsonPath,
    }),
    /incomplete or damaged/i,
  );
});

test("launcher resolves and starts the frozen executable with unchanged arguments", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowent-launcher-runtime-"));
  const target = resolveRuntimeTarget(process.platform, process.arch);
  const platformRoot = join(root, "node_modules", target.alias);
  const packageJsonPath = join(platformRoot, "package.json");
  const binaryPath = join(
    platformRoot,
    "vendor",
    target.rustTarget,
    "flowent",
    target.binaryName,
  );
  await mkdir(dirname(binaryPath), { recursive: true });
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "flowent", version: "0.3.10" }),
  );
  await writeFile(
    packageJsonPath,
    JSON.stringify({
      name: "flowent",
      version: `0.3.10-${target.id}`,
      os: [process.platform],
      cpu: [process.arch],
      ...(process.platform === "linux" ? { libc: "glibc" } : {}),
    }),
  );
  try {
    await link(process.execPath, binaryPath);
  } catch {
    await writeFile(binaryPath, await readFile(process.execPath));
  }
  if (process.platform !== "win32") {
    await chmod(binaryPath, 0o755);
    await access(binaryPath, constants.X_OK);
  }

  const resolved = await resolveInstalledRuntime({
    packageRoot: root,
    platform: process.platform,
    arch: process.arch,
    resolvePackageJson: () => packageJsonPath,
  });
  const result = await runRuntime(resolved.binaryPath, [
    "--eval",
    "process.exit(23)",
  ]);

  assert.equal(resolved.binaryPath, binaryPath);
  assert.deepEqual(result, { code: 23, signal: null });
});

test("runtime forwards termination signals and removes its handlers", async () => {
  const processObject = new EventEmitter();
  const child = new EventEmitter();
  const killed = [];
  child.killed = false;
  child.kill = (signal) => {
    killed.push(signal);
  };
  const run = runRuntime("flowent", ["doctor"], {
    processObject,
    spawnProcess(command, args, options) {
      assert.equal(command, "flowent");
      assert.deepEqual(args, ["doctor"]);
      assert.equal(options.stdio, "inherit");
      return child;
    },
  });

  processObject.emit("SIGTERM");
  child.emit("exit", null, "SIGTERM");

  assert.deepEqual(await run, { code: null, signal: "SIGTERM" });
  assert.deepEqual(killed, ["SIGTERM"]);
  assert.equal(processObject.listenerCount("SIGTERM"), 0);
});
