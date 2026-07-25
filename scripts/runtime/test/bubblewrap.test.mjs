import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { buildBubblewrap, validateStaticLinuxElf } from "../lib/bubblewrap.mjs";

const execFileAsync = promisify(execFile);

async function createSourceArchive(root) {
  const archiveRoot = join(root, "archive");
  const sourceRoot = join(archiveRoot, "bubblewrap-0.11.0");
  await mkdir(sourceRoot, { recursive: true });
  await writeFile(
    join(sourceRoot, "bubblewrap.c"),
    '#include <stdio.h>\nint main(void) { puts("bubblewrap 0.11.0"); return 0; }\n',
  );
  for (const source of ["bind-mount.c", "network.c", "utils.c"]) {
    await writeFile(join(sourceRoot, source), "\n");
  }
  await writeFile(
    join(sourceRoot, "COPYING"),
    "Fixture LGPL-2.0-or-later license\n",
  );
  const archivePath = join(root, "bubblewrap-0.11.0.tar.xz");
  await execFileAsync(
    "tar",
    ["-cJf", archivePath, "-C", archiveRoot, "bubblewrap-0.11.0"],
    { cwd: root },
  );
  const archive = await readFile(archivePath);
  return {
    archivePath,
    size: archive.byteLength,
    sha256: createHash("sha256").update(archive).digest("hex"),
  };
}

test("Bubblewrap build verifies source and emits a static provenance bundle", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "flowent-bubblewrap-build-"));
  let archive;
  try {
    archive = await createSourceArchive(root);
  } catch (error) {
    if (error?.code === "ENOENT") {
      context.skip("tar with xz support is unavailable");
      return;
    }
    throw error;
  }
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const target = {
    id: `linux-${arch}`,
    os: "linux",
    arch,
    rustTarget:
      arch === "arm64"
        ? "aarch64-unknown-linux-gnu"
        : "x86_64-unknown-linux-gnu",
    bubblewrap: {
      version: "0.11.0",
      archive: {
        url: "https://example.com/bubblewrap-0.11.0.tar.xz",
        format: "tar.xz",
        size: archive.size,
        sha256: archive.sha256,
      },
    },
  };
  const outputDir = join(root, "output");
  let result;
  try {
    result = await buildBubblewrap({
      target,
      archivePath: archive.archivePath,
      outputDir,
      compiler: process.env.CC ?? "cc",
    });
  } catch (error) {
    if (
      error?.code === "ENOENT" ||
      /cannot find -lcap|unable to find library -lcap/.test(
        error?.message ?? "",
      )
    ) {
      context.skip("a static C toolchain with libcap is unavailable");
      return;
    }
    throw error;
  }

  const binary = await readFile(result.binaryPath);
  assert.doesNotThrow(() => validateStaticLinuxElf(binary, target));
  assert.equal((await stat(result.binaryPath)).mode & 0o111, 0o111);
  const provenance = JSON.parse(await readFile(result.provenancePath, "utf8"));
  assert.equal(provenance.static, true);
  assert.equal(provenance.target, target.id);
  assert.equal(provenance.sourceArchive.sha256, archive.sha256);
  assert.equal(
    await readFile(join(outputDir, "licenses", "bubblewrap-COPYING"), "utf8"),
    "Fixture LGPL-2.0-or-later license\n",
  );
});

test("Bubblewrap build rejects dynamically linked ELF output", () => {
  const elf = Buffer.alloc(128);
  elf.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]);
  elf.writeUInt16LE(62, 18);
  elf.writeBigUInt64LE(64n, 32);
  elf.writeUInt16LE(56, 54);
  elf.writeUInt16LE(1, 56);
  elf.writeUInt32LE(3, 64);

  assert.throws(
    () =>
      validateStaticLinuxElf(elf, {
        id: "linux-x64",
        os: "linux",
        arch: "x64",
      }),
    /dynamically linked/,
  );
});
