import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

import { fileDigest, verifyFile } from "./download.mjs";

const execFileAsync = promisify(execFile);
const elfMachines = { arm64: 183, x64: 62 };

function requireLinuxTarget(target) {
  if (target.os !== "linux" || !Object.hasOwn(elfMachines, target.arch)) {
    throw new Error(
      `Bubblewrap can only be built for a supported Linux target`,
    );
  }
  const archive = target.bubblewrap?.archive;
  if (
    target.bubblewrap?.version !== "0.11.0" ||
    archive?.format !== "tar.xz" ||
    !Number.isSafeInteger(archive?.size) ||
    typeof archive?.sha256 !== "string"
  ) {
    throw new Error(
      `Target ${target.id} has invalid Bubblewrap source metadata`,
    );
  }
}

async function requireEmptyDirectory(path) {
  await mkdir(path, { recursive: true });
  if ((await readdir(path)).length !== 0) {
    throw new Error(`Bubblewrap output must be empty: ${path}`);
  }
}

async function requireSourceFile(sourceRoot, name) {
  const path = join(sourceRoot, name);
  const sourceStat = await lstat(path);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
    throw new Error(`Bubblewrap source file is invalid: ${name}`);
  }
  return path;
}

function readUnsigned64(buffer, offset) {
  const value = buffer.readBigUInt64LE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Bubblewrap ELF contains an invalid offset");
  }
  return Number(value);
}

export function validateStaticLinuxElf(binary, target) {
  if (
    binary.byteLength < 64 ||
    binary[0] !== 0x7f ||
    binary[1] !== 0x45 ||
    binary[2] !== 0x4c ||
    binary[3] !== 0x46 ||
    binary[4] !== 2 ||
    binary[5] !== 1
  ) {
    throw new Error(
      "Bubblewrap output is not a 64-bit little-endian ELF binary",
    );
  }
  if (binary.readUInt16LE(18) !== elfMachines[target.arch]) {
    throw new Error(`Bubblewrap ELF architecture does not match ${target.id}`);
  }
  const programHeaderOffset = readUnsigned64(binary, 32);
  const programHeaderSize = binary.readUInt16LE(54);
  const programHeaderCount = binary.readUInt16LE(56);
  if (programHeaderSize < 56) {
    throw new Error("Bubblewrap ELF program header is invalid");
  }
  for (let index = 0; index < programHeaderCount; index += 1) {
    const offset = programHeaderOffset + index * programHeaderSize;
    if (offset + programHeaderSize > binary.byteLength) {
      throw new Error("Bubblewrap ELF program header exceeds the file");
    }
    if (binary.readUInt32LE(offset) === 3) {
      throw new Error("Bubblewrap output is dynamically linked");
    }
  }
}

function defaultCompiler(target) {
  if (process.env.FLOWENT_BUBBLEWRAP_CC) {
    return process.env.FLOWENT_BUBBLEWRAP_CC;
  }
  return target.arch === "arm64" ? "aarch64-linux-gnu-gcc" : "cc";
}

export async function buildBubblewrap({
  target,
  archivePath,
  outputDir,
  compiler = defaultCompiler(target),
  tar = "tar",
}) {
  requireLinuxTarget(target);
  await verifyFile(archivePath, target.bubblewrap.archive);
  const outputRoot = resolve(outputDir);
  await requireEmptyDirectory(outputRoot);
  const temporaryRoot = await mkdtemp(
    join(tmpdir(), `flowent-bubblewrap-${randomUUID()}-`),
  );
  const sourceRoot = join(temporaryRoot, "source");
  const buildRoot = join(temporaryRoot, "build");
  await mkdir(sourceRoot);
  await mkdir(buildRoot);
  try {
    await execFileAsync(
      tar,
      [
        "-xJf",
        resolve(archivePath),
        "-C",
        sourceRoot,
        "--strip-components=1",
        "--no-same-owner",
      ],
      { maxBuffer: 16 * 1024 * 1024 },
    );
    const sourceFiles = await Promise.all(
      ["bubblewrap.c", "bind-mount.c", "network.c", "utils.c"].map((name) =>
        requireSourceFile(sourceRoot, name),
      ),
    );
    const copyingPath = await requireSourceFile(sourceRoot, "COPYING");
    await writeFile(
      join(buildRoot, "config.h"),
      '#define PACKAGE_STRING "bubblewrap 0.11.0"\n',
      "utf8",
    );
    const builtBinaryPath = join(buildRoot, "bwrap");
    await execFileAsync(
      compiler,
      [
        "-std=gnu11",
        "-O2",
        "-static",
        "-fPIE",
        "-pie",
        "-fstack-protector-strong",
        "-D_FORTIFY_SOURCE=2",
        "-D_GNU_SOURCE",
        "-I",
        buildRoot,
        "-I",
        sourceRoot,
        ...sourceFiles,
        "-Wl,-z,relro,-z,now",
        "-Wl,--build-id=sha1",
        "-lcap",
        "-o",
        builtBinaryPath,
      ],
      {
        env: {
          ...process.env,
          LC_ALL: "C",
          SOURCE_DATE_EPOCH: "0",
        },
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    const binary = await readFile(builtBinaryPath);
    validateStaticLinuxElf(binary, target);
    const binaryPath = join(outputRoot, "bin", "bwrap");
    const licensePath = join(outputRoot, "licenses", "bubblewrap-COPYING");
    const provenancePath = join(outputRoot, "provenance", "bubblewrap.json");
    await mkdir(dirname(binaryPath), { recursive: true });
    await mkdir(dirname(licensePath), { recursive: true });
    await mkdir(dirname(provenancePath), { recursive: true });
    await copyFile(builtBinaryPath, binaryPath);
    await chmod(binaryPath, 0o755);
    await copyFile(copyingPath, licensePath);
    await chmod(licensePath, 0o644);
    const compilerVersion = (
      await execFileAsync(compiler, ["--version"], {
        maxBuffer: 1024 * 1024,
      })
    ).stdout.split("\n", 1)[0];
    const provenance = {
      schemaVersion: 1,
      component: "bubblewrap",
      version: target.bubblewrap.version,
      target: target.id,
      static: true,
      sourceArchive: {
        url: target.bubblewrap.archive.url,
        size: target.bubblewrap.archive.size,
        sha256: target.bubblewrap.archive.sha256,
      },
      compiler: compilerVersion,
      binary: await fileDigest(binaryPath),
    };
    await writeFile(
      provenancePath,
      `${JSON.stringify(provenance, null, 2)}\n`,
      "utf8",
    );
    await chmod(provenancePath, 0o644);
    return { outputRoot, binaryPath, licensePath, provenancePath, provenance };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
