import { readFile } from "node:fs/promises";
import { posix, win32 } from "node:path";
import process from "node:process";

export const defaultTargetManifestUrl = new URL(
  "../targets.json",
  import.meta.url,
);

const sha256Pattern = /^[a-f0-9]{64}$/;
const supportedPlatforms = new Set(["darwin", "linux", "win32"]);
const supportedArchitectures = new Set(["arm64", "x64"]);

function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function requirePortableRelativePath(value, label) {
  requireString(value, label);
  if (
    value.includes("\\") ||
    posix.isAbsolute(value) ||
    win32.isAbsolute(value)
  ) {
    throw new Error(`${label} must use a portable relative path`);
  }
  const normalized = posix.normalize(value);
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    throw new Error(`${label} escapes its root`);
  }
  return normalized;
}

function validateTarget(targetId, target) {
  if (target === null || typeof target !== "object" || Array.isArray(target)) {
    throw new Error(`Target ${targetId} must be an object`);
  }
  if (target.id !== targetId) {
    throw new Error(`Target ${targetId} has a mismatched id`);
  }
  if (!supportedPlatforms.has(target.os)) {
    throw new Error(`Target ${targetId} has an unsupported operating system`);
  }
  if (!supportedArchitectures.has(target.arch)) {
    throw new Error(`Target ${targetId} has an unsupported architecture`);
  }
  if (!/^[a-z0-9_]+(?:-[a-z0-9_.]+)+$/.test(target.rustTarget)) {
    throw new Error(`Target ${targetId} has an invalid Rust target`);
  }
  requireString(target.sandboxBackend, `Target ${targetId} sandboxBackend`);
  const expectedResources =
    target.os === "linux"
      ? ["bubblewrap", "ripgrep"]
      : target.os === "win32"
        ? ["flowent-native", "ripgrep"]
        : ["ripgrep"];
  if (
    !Array.isArray(target.requiredResources) ||
    JSON.stringify([...target.requiredResources].sort()) !==
      JSON.stringify(expectedResources)
  ) {
    throw new Error(`Target ${targetId} has invalid required resources`);
  }
  if (target.executableSuffix !== "" && target.executableSuffix !== ".exe") {
    throw new Error(`Target ${targetId} has an invalid executable suffix`);
  }
  if (target.npm?.alias !== `flowent-${targetId}`) {
    throw new Error(`Target ${targetId} has an invalid npm alias`);
  }
  if (target.npm?.name !== "flowent") {
    throw new Error(`Target ${targetId} has an invalid npm package name`);
  }
  if (target.npm?.versionTag !== targetId) {
    throw new Error(`Target ${targetId} has an invalid npm version tag`);
  }
  if (target.npm?.os !== target.os || target.npm?.cpu !== target.arch) {
    throw new Error(`Target ${targetId} has mismatched npm platform metadata`);
  }
  if (
    (target.os === "linux" && target.npm?.libc !== "glibc") ||
    (target.os !== "linux" && target.npm?.libc !== undefined)
  ) {
    throw new Error(`Target ${targetId} has invalid npm libc metadata`);
  }
  requireString(
    target.python?.wheelPlatform,
    `Target ${targetId} wheel platform`,
  );
  requireString(target.ripgrep?.version, `Target ${targetId} ripgrep version`);
  requirePortableRelativePath(
    target.ripgrep?.binaryPath,
    `Target ${targetId} ripgrep binary path`,
  );
  if (
    !Array.isArray(target.ripgrep?.licensePaths) ||
    target.ripgrep.licensePaths.length === 0
  ) {
    throw new Error(`Target ${targetId} must declare ripgrep licenses`);
  }
  for (const licensePath of target.ripgrep.licensePaths) {
    requirePortableRelativePath(
      licensePath,
      `Target ${targetId} ripgrep license path`,
    );
  }
  const archive = target.ripgrep?.archive;
  if (archive?.format !== "tar.gz" && archive?.format !== "zip") {
    throw new Error(`Target ${targetId} has an invalid ripgrep archive format`);
  }
  if (!Number.isSafeInteger(archive.size) || archive.size <= 0) {
    throw new Error(`Target ${targetId} has an invalid ripgrep archive size`);
  }
  if (!sha256Pattern.test(archive.sha256)) {
    throw new Error(`Target ${targetId} has an invalid ripgrep SHA256`);
  }
  const archiveUrl = new URL(archive.url);
  if (archiveUrl.protocol !== "https:") {
    throw new Error(`Target ${targetId} ripgrep URL must use HTTPS`);
  }
  if (target.os === "linux") {
    if (target.bubblewrap?.version !== "0.11.0") {
      throw new Error(`Target ${targetId} has an invalid Bubblewrap version`);
    }
    if (target.bubblewrap?.licenseSpdx !== "LGPL-2.0-or-later") {
      throw new Error(`Target ${targetId} has an invalid Bubblewrap license`);
    }
    if (target.bubblewrap?.licensePath !== "COPYING") {
      throw new Error(
        `Target ${targetId} has an invalid Bubblewrap license path`,
      );
    }
    const sourceCodeUrl = new URL(target.bubblewrap.sourceCodeUrl);
    if (sourceCodeUrl.protocol !== "https:") {
      throw new Error(
        `Target ${targetId} Bubblewrap source URL must use HTTPS`,
      );
    }
    const bubblewrapArchive = target.bubblewrap.archive;
    if (
      bubblewrapArchive?.format !== "tar.xz" ||
      !Number.isSafeInteger(bubblewrapArchive.size) ||
      bubblewrapArchive.size <= 0 ||
      !sha256Pattern.test(bubblewrapArchive.sha256)
    ) {
      throw new Error(
        `Target ${targetId} has invalid Bubblewrap archive metadata`,
      );
    }
    const bubblewrapArchiveUrl = new URL(bubblewrapArchive.url);
    if (bubblewrapArchiveUrl.protocol !== "https:") {
      throw new Error(
        `Target ${targetId} Bubblewrap archive URL must use HTTPS`,
      );
    }
  }
}

export async function loadTargetManifest(
  manifestPath = defaultTargetManifestUrl,
) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.schemaVersion !== 1) {
    throw new Error("Unsupported target manifest schema version");
  }
  if (manifest.targets === null || typeof manifest.targets !== "object") {
    throw new Error("Target manifest must contain targets");
  }
  for (const [targetId, target] of Object.entries(manifest.targets)) {
    validateTarget(targetId, target);
  }
  return manifest;
}

export function resolveTarget(manifest, targetId) {
  const target = manifest.targets[targetId];
  if (!target) {
    throw new Error(`Unsupported runtime target: ${targetId}`);
  }
  return target;
}

export function resolveCurrentTarget(
  manifest,
  platform = process.platform,
  arch = process.arch,
) {
  return resolveTarget(manifest, `${platform}-${arch}`);
}

export function npmPackageMetadata(target, baseVersion) {
  requireString(baseVersion, "Base version");
  const version = `${baseVersion}-${target.npm.versionTag}`;
  return {
    alias: target.npm.alias,
    name: target.npm.name,
    version,
    dependency: `npm:${target.npm.name}@${version}`,
    os: [target.npm.os],
    cpu: [target.npm.cpu],
    ...(target.npm.libc ? { libc: target.npm.libc } : {}),
  };
}
