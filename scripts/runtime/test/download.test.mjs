import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { downloadVerified } from "../lib/download.mjs";

const fixtureUrl = new URL("./fixtures/ripgrep.fixture", import.meta.url);
const fixture = await readFile(fixtureUrl);
const sha256 = createHash("sha256").update(fixture).digest("hex");

test("verified download accepts a local fixture with matching size and SHA256", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowent-runtime-download-"));
  const destination = join(root, "ripgrep.fixture");

  const result = await downloadVerified({
    url: fixtureUrl,
    destination,
    size: fixture.byteLength,
    sha256,
  });

  assert.deepEqual(await readFile(destination), fixture);
  assert.equal(result.size, fixture.byteLength);
  assert.equal(result.sha256, sha256);
});

test("verified download rejects a size mismatch without leaving the target file", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowent-runtime-download-"));
  const destination = join(root, "ripgrep.fixture");

  await assert.rejects(
    downloadVerified({
      url: fixtureUrl,
      destination,
      size: fixture.byteLength + 1,
      sha256,
    }),
    /size mismatch/,
  );
  await assert.rejects(readFile(destination), /ENOENT/);
});

test("verified download rejects a SHA256 mismatch without leaving the target file", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowent-runtime-download-"));
  const destination = join(root, "ripgrep.fixture");

  await assert.rejects(
    downloadVerified({
      url: fixtureUrl,
      destination,
      size: fixture.byteLength,
      sha256: "0".repeat(64),
    }),
    /SHA256 mismatch/,
  );
  await assert.rejects(readFile(destination), /ENOENT/);
});
