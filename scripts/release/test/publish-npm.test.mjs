import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import test from "node:test";

import {
  packageIdentityFromTarball,
  publishNpmPackage,
  sha512Integrity,
  verifyPublishedIntegrity,
} from "../publish-npm-package.mjs";

function tarEntry(path, contents) {
  const body = Buffer.from(contents);
  const header = Buffer.alloc(512);
  header.write(path, 0, 100, "utf8");
  header.write("0000644\0", 100, 8, "ascii");
  header.write("0000000\0", 108, 8, "ascii");
  header.write("0000000\0", 116, 8, "ascii");
  header.write(
    `${body.length.toString(8).padStart(11, "0")}\0`,
    124,
    12,
    "ascii",
  );
  header.write("00000000000\0", 136, 12, "ascii");
  header.fill(32, 148, 156);
  header.write("0", 156, 1, "ascii");
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  const padding = Buffer.alloc((512 - (body.length % 512)) % 512);
  return Buffer.concat([header, body, padding]);
}

function packageTarball(manifest) {
  return gzipSync(
    Buffer.concat([
      tarEntry("package/package.json", JSON.stringify(manifest)),
      Buffer.alloc(1024),
    ]),
  );
}

test("reads the exact npm package identity from a packed tarball", () => {
  const tarball = packageTarball({
    name: "flowent",
    version: "0.3.10-linux-x64",
  });

  assert.deepEqual(packageIdentityFromTarball(tarball), {
    name: "flowent",
    version: "0.3.10-linux-x64",
  });
});

test("computes npm SHA512 integrity for the packed bytes", () => {
  const tarball = packageTarball({ name: "flowent", version: "0.3.10" });

  assert.equal(
    sha512Integrity(tarball),
    `sha512-${createHash("sha512").update(tarball).digest("base64")}`,
  );
});

test("accepts an existing exact version only when registry integrity matches", () => {
  const integrity = "sha512-matching";

  assert.doesNotThrow(() =>
    verifyPublishedIntegrity("flowent@0.3.10", integrity, integrity),
  );
  assert.throws(
    () =>
      verifyPublishedIntegrity("flowent@0.3.10", integrity, "sha512-different"),
    /integrity does not match/,
  );
});

test("skips an existing exact version with identical packed bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowent-npm-publish-"));
  const packagePath = join(root, "flowent.tgz");
  const tarball = packageTarball({ name: "flowent", version: "0.3.10" });
  await writeFile(packagePath, tarball);
  let publishCalled = false;

  const result = await publishNpmPackage(packagePath, {
    queryIntegrity: async (spec) => {
      assert.equal(spec, "flowent@0.3.10");
      return sha512Integrity(tarball);
    },
    publish: async () => {
      publishCalled = true;
    },
  });

  assert.equal(result.published, false);
  assert.equal(publishCalled, false);
});

test("publishes only when the exact version is absent", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowent-npm-publish-"));
  const packagePath = join(root, "flowent.tgz");
  await writeFile(
    packagePath,
    packageTarball({ name: "flowent", version: "0.3.10-linux-x64" }),
  );
  const calls = [];

  const result = await publishNpmPackage(packagePath, {
    tag: "platform",
    queryIntegrity: async () => undefined,
    publish: async (...args) => calls.push(args),
  });

  assert.equal(result.published, true);
  assert.deepEqual(calls, [[packagePath, "platform"]]);
});

test("does not publish when an exact version has different packed bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowent-npm-publish-"));
  const packagePath = join(root, "flowent.tgz");
  await writeFile(
    packagePath,
    packageTarball({ name: "flowent", version: "0.3.10" }),
  );
  let publishCalled = false;

  await assert.rejects(
    publishNpmPackage(packagePath, {
      queryIntegrity: async () => "sha512-different",
      publish: async () => {
        publishCalled = true;
      },
    }),
    /integrity does not match/,
  );
  assert.equal(publishCalled, false);
});
