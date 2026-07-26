#!/usr/bin/env node

import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const runtimeTargets = {
  "darwin-arm64": {
    alias: "flowent-darwin-arm64",
    binaryName: "flowent",
    rustTarget: "aarch64-apple-darwin",
  },
  "darwin-x64": {
    alias: "flowent-darwin-x64",
    binaryName: "flowent",
    rustTarget: "x86_64-apple-darwin",
  },
  "linux-arm64": {
    alias: "flowent-linux-arm64",
    binaryName: "flowent",
    libc: "glibc",
    rustTarget: "aarch64-unknown-linux-gnu",
  },
  "linux-x64": {
    alias: "flowent-linux-x64",
    binaryName: "flowent",
    libc: "glibc",
    rustTarget: "x86_64-unknown-linux-gnu",
  },
  "win32-arm64": {
    alias: "flowent-win32-arm64",
    binaryName: "flowent.exe",
    rustTarget: "aarch64-pc-windows-msvc",
  },
  "win32-x64": {
    alias: "flowent-win32-x64",
    binaryName: "flowent.exe",
    rustTarget: "x86_64-pc-windows-msvc",
  },
};

function computerFilesMissing() {
  return new Error(
    "Flowent files for this computer are missing. Reinstall Flowent and try again.",
  );
}

function computerFilesInvalid() {
  return new Error(
    "Flowent files for this computer are incomplete or damaged. Reinstall Flowent and try again.",
  );
}

export function resolveRuntimeTarget(platform, arch) {
  const id = `${platform}-${arch}`;
  const target = runtimeTargets[id];
  if (!target) {
    throw new Error(`Flowent is not available for ${platform} ${arch}.`);
  }
  return { id, ...target };
}

async function isPathWithin(path, root) {
  const resolvedPath = await realpath(path);
  const resolvedRoot = await realpath(root);
  const pathFromRoot = relative(resolvedRoot, resolvedPath);
  return (
    pathFromRoot === "" ||
    (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot))
  );
}

export async function resolveInstalledRuntime({
  packageRoot,
  platform = process.platform,
  arch = process.arch,
  resolvePackageJson,
}) {
  const target = resolveRuntimeTarget(platform, arch);
  let mainPackage;
  try {
    mainPackage = JSON.parse(
      await readFile(join(packageRoot, "package.json"), "utf8"),
    );
  } catch {
    throw computerFilesInvalid();
  }
  const packageJsonResolver =
    resolvePackageJson ??
    ((specifier) =>
      createRequire(join(packageRoot, "package.json")).resolve(specifier));
  let packageJsonPath;
  try {
    packageJsonPath = packageJsonResolver(`${target.alias}/package.json`);
  } catch (error) {
    if (error?.code === "MODULE_NOT_FOUND") {
      throw computerFilesMissing();
    }
    throw computerFilesInvalid();
  }
  const platformRoot = dirname(packageJsonPath);
  let platformPackage;
  try {
    platformPackage = JSON.parse(await readFile(packageJsonPath, "utf8"));
  } catch {
    throw computerFilesInvalid();
  }
  if (
    platformPackage.name !== "flowent" ||
    platformPackage.version !== `${mainPackage.version}-${target.id}` ||
    !platformPackage.os?.includes(platform) ||
    !platformPackage.cpu?.includes(arch) ||
    (target.libc !== undefined && platformPackage.libc !== target.libc)
  ) {
    throw computerFilesInvalid();
  }
  const binaryPath = join(
    platformRoot,
    "vendor",
    target.rustTarget,
    "flowent",
    target.binaryName,
  );
  try {
    await access(
      binaryPath,
      platform === "win32" ? constants.F_OK : constants.F_OK | constants.X_OK,
    );
    if (!(await isPathWithin(binaryPath, platformRoot))) {
      throw computerFilesInvalid();
    }
  } catch {
    throw computerFilesInvalid();
  }
  return { binaryPath, target };
}

export function runRuntime(
  binaryPath,
  args,
  { processObject = process, spawnProcess = spawn } = {},
) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawnProcess(binaryPath, args, {
      cwd: processObject.cwd?.() ?? process.cwd(),
      env: processObject.env ?? process.env,
      stdio: "inherit",
    });
    const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
    const handlers = new Map();
    const cleanup = () => {
      for (const [signal, handler] of handlers) {
        processObject.removeListener(signal, handler);
      }
    };
    for (const signal of signals) {
      const handler = () => {
        if (!child.killed) {
          child.kill(signal);
        }
      };
      handlers.set(signal, handler);
      processObject.on(signal, handler);
    }
    child.once("error", (error) => {
      cleanup();
      rejectPromise(error);
    });
    child.once("exit", (code, signal) => {
      cleanup();
      resolvePromise({ code, signal });
    });
  });
}

async function main() {
  const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  try {
    const runtime = await resolveInstalledRuntime({ packageRoot });
    const result = await runRuntime(runtime.binaryPath, process.argv.slice(2));
    if (result.signal) {
      process.kill(process.pid, result.signal);
      return;
    }
    process.exitCode = result.code ?? 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

async function isInvoked() {
  if (!process.argv[1]) {
    return false;
  }
  try {
    const [modulePath, invokedPath] = await Promise.all([
      realpath(fileURLToPath(import.meta.url)),
      realpath(resolve(process.argv[1])),
    ]);
    return modulePath === invokedPath;
  } catch {
    return false;
  }
}

if (await isInvoked()) {
  await main();
}
