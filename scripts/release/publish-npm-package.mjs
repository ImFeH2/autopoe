import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";

const execFileAsync = promisify(execFile);

export function sha512Integrity(tarball) {
  return `sha512-${createHash("sha512").update(tarball).digest("base64")}`;
}

export function packageIdentityFromTarball(tarball) {
  const archive = gunzipSync(tarball);
  let offset = 0;

  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      break;
    }
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/s, "");
    const sizeText = header
      .subarray(124, 136)
      .toString("ascii")
      .replace(/\0.*$/s, "")
      .trim();
    const size = Number.parseInt(sizeText || "0", 8);
    const bodyOffset = offset + 512;

    if (
      !Number.isSafeInteger(size) ||
      size < 0 ||
      bodyOffset + size > archive.length
    ) {
      throw new Error("Invalid npm package tarball");
    }
    if (name === "package/package.json") {
      const manifest = JSON.parse(
        archive.subarray(bodyOffset, bodyOffset + size).toString("utf8"),
      );
      if (
        typeof manifest.name !== "string" ||
        !manifest.name ||
        typeof manifest.version !== "string" ||
        !manifest.version
      ) {
        throw new Error("npm package manifest must include name and version");
      }
      return { name: manifest.name, version: manifest.version };
    }

    offset = bodyOffset + Math.ceil(size / 512) * 512;
  }

  throw new Error("npm package tarball does not contain package/package.json");
}

export function verifyPublishedIntegrity(
  spec,
  localIntegrity,
  registryIntegrity,
) {
  if (localIntegrity !== registryIntegrity) {
    throw new Error(
      `${spec} already exists, but its registry integrity does not match the local package`,
    );
  }
}

async function registryIntegrity(spec) {
  try {
    const { stdout } = await execFileAsync(
      "npm",
      ["view", spec, "dist.integrity", "--json"],
      { encoding: "utf8" },
    );
    const integrity = JSON.parse(stdout);
    if (typeof integrity !== "string" || !integrity) {
      throw new Error(`npm registry returned no integrity for ${spec}`);
    }
    return integrity;
  } catch (error) {
    const output = `${error?.stdout ?? ""}\n${error?.stderr ?? ""}`;
    if (/\bE404\b|404 Not Found/i.test(output)) {
      return undefined;
    }
    throw error;
  }
}

async function npmPublish(packagePath, tag) {
  const args = ["publish", packagePath, "--access", "public", "--provenance"];
  if (tag) {
    args.push("--tag", tag);
  }
  await new Promise((resolvePromise, reject) => {
    const child = spawn("npm", args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(
        new Error(
          signal
            ? `npm publish terminated by ${signal}`
            : `npm publish exited with code ${code}`,
        ),
      );
    });
  });
}

export async function publishNpmPackage(
  packagePath,
  { tag, queryIntegrity = registryIntegrity, publish = npmPublish } = {},
) {
  const tarball = await readFile(packagePath);
  const identity = packageIdentityFromTarball(tarball);
  const spec = `${identity.name}@${identity.version}`;
  const localIntegrity = sha512Integrity(tarball);
  const publishedIntegrity = await queryIntegrity(spec);

  if (publishedIntegrity !== undefined) {
    verifyPublishedIntegrity(spec, localIntegrity, publishedIntegrity);
    process.stdout.write(`${spec} already exists with matching integrity.\n`);
    return { published: false, spec, integrity: localIntegrity };
  }

  await publish(packagePath, tag);
  return { published: true, spec, integrity: localIntegrity };
}

function parseArguments(argv) {
  const [packagePath, ...options] = argv;
  if (!packagePath) {
    throw new Error(
      "Usage: publish-npm-package.mjs <package.tgz> [--tag <tag>]",
    );
  }
  let tag;
  for (let index = 0; index < options.length; index += 1) {
    if (options[index] !== "--tag" || !options[index + 1] || tag) {
      throw new Error(
        "Usage: publish-npm-package.mjs <package.tgz> [--tag <tag>]",
      );
    }
    tag = options[index + 1];
    index += 1;
  }
  return { packagePath, tag };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  const { packagePath, tag } = parseArguments(process.argv.slice(2));
  await publishNpmPackage(packagePath, { tag });
}
