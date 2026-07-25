import { spawn } from "node:child_process";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import process from "node:process";

import { buildBubblewrap } from "../../runtime/lib/bubblewrap.mjs";
import { downloadVerified } from "../../runtime/lib/download.mjs";
import { writeRuntimeResourcePlan } from "../../runtime/lib/plan.mjs";
import {
  loadTargetManifest,
  resolveTarget,
} from "../../runtime/lib/targets.mjs";

function runCommand(command, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { ...options, stdio: "inherit" });
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(
        new Error(
          signal
            ? `${command} stopped with ${signal}.`
            : `${command} exited with code ${code}.`,
        ),
      );
    });
  });
}

async function requireEmptyDirectory(path) {
  await mkdir(path, { recursive: true });
  if ((await readdir(path)).length !== 0) {
    throw new Error(`Release runtime output must be empty: ${path}`);
  }
}

async function requireRegularFile(path, label) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file: ${path}`);
  }
  return path;
}

async function copyExecutable(source, destination) {
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
  await chmod(destination, 0o755);
}

async function copyDocument(source, destination) {
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
  await chmod(destination, 0o644);
}

export function targetIdForHost(platform, arch) {
  if (
    !new Set(["darwin", "linux", "win32"]).has(platform) ||
    !new Set(["arm64", "x64"]).has(arch)
  ) {
    throw new Error(`Unsupported release host: ${platform} ${arch}`);
  }
  return `${platform}-${arch}`;
}

export function nativeBuildConfiguration(target) {
  const windows = target.os === "win32";
  const crate = windows ? "flowent-sandbox-windows" : "flowent-native";
  return {
    manifest: posix.join("native", crate, "Cargo.toml"),
    binary: posix.join(
      "native",
      crate,
      "target",
      target.rustTarget,
      "release",
      `flowent-native${target.executableSuffix}`,
    ),
    rustTarget: target.rustTarget,
  };
}

export async function prepareNativeRuntime({
  targetId,
  nativeBinary,
  outputDir,
  version,
  projectRoot = process.cwd(),
  platform = process.platform,
  arch = process.arch,
  tarCommand = "tar",
  compiler,
}) {
  const manifest = await loadTargetManifest();
  const target = resolveTarget(manifest, targetId);
  const hostTarget = targetIdForHost(platform, arch);
  if (target.id !== hostTarget) {
    throw new Error(`${target.id} must be prepared on ${hostTarget}.`);
  }
  const root = resolve(projectRoot);
  const output = resolve(outputDir);
  await requireEmptyDirectory(output);
  const temporary = await mkdtemp(join(tmpdir(), "flowent-release-runtime-"));
  try {
    const ripgrepArchive = join(temporary, "ripgrep.archive");
    const ripgrepRoot = join(temporary, "ripgrep");
    await mkdir(ripgrepRoot);
    await downloadVerified({
      url: target.ripgrep.archive.url,
      destination: ripgrepArchive,
      size: target.ripgrep.archive.size,
      sha256: target.ripgrep.archive.sha256,
    });
    await runCommand(tarCommand, [
      "--no-same-owner",
      "-xf",
      ripgrepArchive,
      "-C",
      ripgrepRoot,
    ]);

    await copyDocument(join(root, "LICENSE"), join(output, "LICENSE"));
    if (target.os === "win32") {
      if (!nativeBinary) {
        throw new Error(
          `Target ${target.id} requires the Windows native helper.`,
        );
      }
      await copyExecutable(
        await requireRegularFile(resolve(nativeBinary), "Native helper"),
        join(output, "bin", `flowent-native${target.executableSuffix}`),
      );
    }
    await copyExecutable(
      await requireRegularFile(
        join(ripgrepRoot, ...target.ripgrep.binaryPath.split("/")),
        "ripgrep executable",
      ),
      join(output, "bin", `rg${target.executableSuffix}`),
    );
    await copyDocument(
      await requireRegularFile(
        join(ripgrepRoot, ...target.ripgrep.licensePaths[0].split("/")),
        "ripgrep MIT license",
      ),
      join(output, "licenses", "ripgrep-MIT.txt"),
    );
    await copyDocument(
      await requireRegularFile(
        join(ripgrepRoot, ...target.ripgrep.licensePaths[1].split("/")),
        "ripgrep Unlicense",
      ),
      join(output, "licenses", "ripgrep-UNLICENSE.txt"),
    );

    if (target.bubblewrap) {
      const bubblewrapArchive = join(temporary, "bubblewrap.archive");
      const bubblewrapOutput = join(temporary, "bubblewrap");
      await downloadVerified({
        url: target.bubblewrap.archive.url,
        destination: bubblewrapArchive,
        size: target.bubblewrap.archive.size,
        sha256: target.bubblewrap.archive.sha256,
      });
      const built = await buildBubblewrap({
        target,
        archivePath: bubblewrapArchive,
        outputDir: bubblewrapOutput,
        compiler,
        tar: tarCommand,
      });
      await copyExecutable(built.binaryPath, join(output, "bin", "bwrap"));
      await copyDocument(
        built.licensePath,
        join(output, "licenses", "bubblewrap-COPYING"),
      );
      await copyDocument(
        built.provenancePath,
        join(output, "provenance", "bubblewrap.json"),
      );
    }

    const planPath = join(output, "runtime-plan.json");
    const { plan } = await writeRuntimeResourcePlan({
      target,
      version,
      outputPath: planPath,
    });
    return { outputDir: output, planPath, plan, target };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
