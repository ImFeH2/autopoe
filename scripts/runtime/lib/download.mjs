import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const sha256Pattern = /^[a-f0-9]{64}$/;

function normalizeExpected(size, sha256) {
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new Error("Expected size must be a non-negative safe integer");
  }
  if (!sha256Pattern.test(sha256)) {
    throw new Error(
      "Expected SHA256 must be 64 lowercase hexadecimal characters",
    );
  }
}

export async function fileDigest(path) {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(path)) {
    size += chunk.byteLength;
    hash.update(chunk);
  }
  return { size, sha256: hash.digest("hex") };
}

export async function verifyFile(path, expected) {
  normalizeExpected(expected.size, expected.sha256);
  const actual = await fileDigest(path);
  if (actual.size !== expected.size) {
    throw new Error(
      `Download size mismatch: expected ${expected.size}, received ${actual.size}`,
    );
  }
  if (actual.sha256 !== expected.sha256) {
    throw new Error(
      `Download SHA256 mismatch: expected ${expected.sha256}, received ${actual.sha256}`,
    );
  }
  return actual;
}

async function sourceStream(sourceUrl, fetchImpl) {
  if (sourceUrl.protocol === "file:") {
    return createReadStream(fileURLToPath(sourceUrl));
  }
  if (sourceUrl.protocol !== "https:") {
    throw new Error(`Unsupported download protocol: ${sourceUrl.protocol}`);
  }
  const response = await fetchImpl(sourceUrl, {
    redirect: "follow",
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok || response.body === null) {
    throw new Error(`Download failed with HTTP ${response.status}`);
  }
  return response.body;
}

export async function downloadVerified({
  url,
  destination,
  size,
  sha256,
  fetchImpl = globalThis.fetch,
}) {
  normalizeExpected(size, sha256);
  const sourceUrl = url instanceof URL ? url : new URL(url);
  const destinationPath = resolve(destination);
  await mkdir(dirname(destinationPath), { recursive: true });
  const temporaryPath = `${destinationPath}.${process.pid}.${randomUUID()}.tmp`;
  const hash = createHash("sha256");
  let receivedSize = 0;
  const output = await open(temporaryPath, "wx");
  try {
    const stream = await sourceStream(sourceUrl, fetchImpl);
    for await (const chunk of stream) {
      const bytes = Buffer.from(chunk);
      receivedSize += bytes.byteLength;
      hash.update(bytes);
      await output.write(bytes);
    }
  } catch (error) {
    await output.close();
    await rm(temporaryPath, { force: true });
    throw error;
  }
  await output.close();
  const receivedSha256 = hash.digest("hex");
  if (receivedSize !== size) {
    await rm(temporaryPath, { force: true });
    throw new Error(
      `Download size mismatch: expected ${size}, received ${receivedSize}`,
    );
  }
  if (receivedSha256 !== sha256) {
    await rm(temporaryPath, { force: true });
    throw new Error(
      `Download SHA256 mismatch: expected ${sha256}, received ${receivedSha256}`,
    );
  }
  await rm(destinationPath, { force: true });
  await rename(temporaryPath, destinationPath);
  const destinationStat = await stat(destinationPath);
  if (destinationStat.size !== size) {
    await rm(destinationPath, { force: true });
    throw new Error("Verified download changed while being committed");
  }
  return { path: destinationPath, size: receivedSize, sha256: receivedSha256 };
}
