import { constants } from "node:fs";
import {
  access,
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  win32,
} from "node:path";
import { fileURLToPath } from "node:url";

import { fileDigest } from "./download.mjs";
import {
  loadTargetManifest,
  npmPackageMetadata,
  resolveTarget,
} from "./targets.mjs";

function toPath(value) {
  return value instanceof URL ? fileURLToPath(value) : resolve(value);
}

function portablePath(path) {
  return path.split("\\").join("/");
}

function safeRelativePath(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty relative path`);
  }
  if (
    posix.isAbsolute(value) ||
    win32.isAbsolute(value) ||
    value.includes("\\")
  ) {
    throw new Error(`${label} must use a portable relative path`);
  }
  const normalized = posix.normalize(value);
  if (
    normalized === "." ||
    normalized.startsWith("../") ||
    normalized === ".."
  ) {
    throw new Error(`${label} escapes its root`);
  }
  return normalized;
}

function renderPathTemplate(value, target, label) {
  if (
    typeof value !== "string" ||
    value.replaceAll("{exe}", "").includes("{")
  ) {
    throw new Error(`${label} contains an unsupported path template`);
  }
  return safeRelativePath(
    value.replaceAll("{exe}", target.executableSuffix),
    label,
  );
}

async function requireRegularFile(root, source, label) {
  const relativeSource = safeRelativePath(source, label);
  const parts = relativeSource.split("/");
  const path = join(root, ...parts);
  const rootRelative = relative(root, path);
  if (rootRelative.startsWith("..") || isAbsolute(rootRelative)) {
    throw new Error(`${label} escapes its source directory`);
  }
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) {
      throw new Error(`${label} path traverses a symbolic link`);
    }
  }
  const sourceStat = await lstat(path);
  if (!sourceStat.isFile()) {
    throw new Error(`${label} must refer to a regular file`);
  }
  return path;
}

async function requireEmptyDirectory(path) {
  await mkdir(path, { recursive: true });
  if ((await readdir(path)).length !== 0) {
    throw new Error(`Staging output must be empty: ${path}`);
  }
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function validateResource(resource, names, destinations) {
  if (
    resource === null ||
    typeof resource !== "object" ||
    Array.isArray(resource)
  ) {
    throw new Error("Each runtime resource must be an object");
  }
  if (
    typeof resource.name !== "string" ||
    !/^[a-z][a-z0-9-]*$/.test(resource.name)
  ) {
    throw new Error(
      "Runtime resource names must use lowercase letters, digits, and hyphens",
    );
  }
  if (names.has(resource.name)) {
    throw new Error(`Duplicate runtime resource: ${resource.name}`);
  }
  names.add(resource.name);
  if (
    resource.targets !== undefined &&
    (!Array.isArray(resource.targets) ||
      resource.targets.length === 0 ||
      resource.targets.some(
        (target) => typeof target !== "string" || target.length === 0,
      ))
  ) {
    throw new Error(`Resource ${resource.name} has invalid targets`);
  }
  safeRelativePath(resource.source, `Resource ${resource.name} source`);
  const destination = safeRelativePath(
    resource.destination,
    `Resource ${resource.name} destination`,
  );
  if (destinations.has(destination)) {
    throw new Error(`Duplicate runtime destination: ${destination}`);
  }
  destinations.add(destination);
  if (typeof resource.executable !== "boolean") {
    throw new Error(`Resource ${resource.name} must declare executable`);
  }
  if (typeof resource.version !== "string" || resource.version.length === 0) {
    throw new Error(`Resource ${resource.name} must declare a version`);
  }
  const sourceUrl = new URL(resource.sourceUrl);
  if (sourceUrl.protocol !== "https:") {
    throw new Error(`Resource ${resource.name} source URL must use HTTPS`);
  }
  const sourceCodeUrl = new URL(resource.sourceCodeUrl);
  if (sourceCodeUrl.protocol !== "https:") {
    throw new Error(`Resource ${resource.name} source code URL must use HTTPS`);
  }
  if (!Array.isArray(resource.licenses) || resource.licenses.length === 0) {
    throw new Error(
      `Resource ${resource.name} must declare at least one license`,
    );
  }
  for (const license of resource.licenses) {
    if (typeof license.spdx !== "string" || license.spdx.length === 0) {
      throw new Error(`Resource ${resource.name} has an invalid SPDX license`);
    }
    safeRelativePath(
      license.source,
      `Resource ${resource.name} license source`,
    );
    const licenseDestination = safeRelativePath(
      license.destination,
      `Resource ${resource.name} license destination`,
    );
    if (!licenseDestination.startsWith("licenses/")) {
      throw new Error(
        `Resource ${resource.name} licenses must be staged under licenses/`,
      );
    }
  }
  if (
    resource.name === "bubblewrap" &&
    !resource.licenses.some((license) => license.spdx === "LGPL-2.0-or-later")
  ) {
    throw new Error("Bubblewrap must include its LGPL-2.0-or-later license");
  }
  if (resource.buildProvenance !== undefined) {
    safeRelativePath(
      resource.buildProvenance,
      `Resource ${resource.name} build provenance`,
    );
  }
  if (
    resource.name === "bubblewrap" &&
    resource.buildProvenance === undefined
  ) {
    throw new Error("Bubblewrap must include static build provenance");
  }
}

function validateProjectLicense(projectLicense) {
  if (projectLicense === null || typeof projectLicense !== "object") {
    throw new Error("Runtime resource plan must declare the project license");
  }
  safeRelativePath(projectLicense.source, "Project license source");
  if (projectLicense.spdx !== "Apache-2.0") {
    throw new Error("Flowent project license must be Apache-2.0");
  }
}

export function validateResourcePlan(plan) {
  if (plan.schemaVersion !== 1 || !Array.isArray(plan.resources)) {
    throw new Error("Unsupported runtime resource plan");
  }
  validateProjectLicense(plan.projectLicense);
  const names = new Set();
  const destinations = new Set();
  for (const resource of plan.resources) {
    validateResource(resource, names, destinations);
  }
  return plan;
}

export async function loadResourcePlan(planPath) {
  return validateResourcePlan(JSON.parse(await readFile(planPath, "utf8")));
}

export async function stageRuntimeBundle({
  targetId,
  sourceDir,
  outputDir,
  resources,
  projectLicense,
  targetManifestPath,
}) {
  const targetManifest = await loadTargetManifest(targetManifestPath);
  const target = resolveTarget(targetManifest, targetId);
  const sourceRoot = toPath(sourceDir);
  const bundleRoot = toPath(outputDir);
  validateProjectLicense(projectLicense);
  const activeResources = resources.filter(
    (resource) =>
      resource.targets === undefined || resource.targets.includes(targetId),
  );
  const names = new Set();
  const destinations = new Set();
  for (const resource of activeResources) {
    validateResource(resource, names, destinations);
  }
  for (const requiredResource of target.requiredResources) {
    if (!names.has(requiredResource)) {
      throw new Error(
        `Target ${targetId} is missing required resource: ${requiredResource}`,
      );
    }
  }
  await access(sourceRoot, constants.R_OK);
  await requireEmptyDirectory(bundleRoot);
  const projectLicenseSource = await requireRegularFile(
    sourceRoot,
    projectLicense.source,
    "Project license source",
  );
  const projectLicensePath = join(bundleRoot, "LICENSE");
  await copyFile(projectLicenseSource, projectLicensePath);
  await chmod(projectLicensePath, 0o644);
  const stagedProjectLicense = {
    path: "LICENSE",
    spdx: projectLicense.spdx,
    ...(await fileDigest(projectLicensePath)),
  };
  const stagedResources = {};
  const stagedLicenses = {};
  const noticeLines = ["Flowent Third-Party Notices", ""];
  for (const resource of [...activeResources].sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const sourceTemplate = renderPathTemplate(
      resource.source,
      target,
      `Resource ${resource.name} source`,
    );
    const source = await requireRegularFile(
      sourceRoot,
      sourceTemplate,
      `Resource ${resource.name} source`,
    );
    const destination = renderPathTemplate(
      resource.destination,
      target,
      `Resource ${resource.name} destination`,
    );
    const destinationPath = join(bundleRoot, ...destination.split("/"));
    await mkdir(dirname(destinationPath), { recursive: true });
    await copyFile(source, destinationPath);
    await chmod(destinationPath, resource.executable ? 0o755 : 0o644);
    const digest = await fileDigest(destinationPath);
    let buildProvenance;
    if (resource.buildProvenance !== undefined) {
      const provenanceSource = await requireRegularFile(
        sourceRoot,
        resource.buildProvenance,
        `Resource ${resource.name} build provenance`,
      );
      let provenance;
      try {
        provenance = JSON.parse(await readFile(provenanceSource, "utf8"));
      } catch (error) {
        throw new Error(
          `Resource ${resource.name} build provenance could not be read`,
          { cause: error },
        );
      }
      if (
        provenance.schemaVersion !== 1 ||
        provenance.component !== resource.name ||
        provenance.version !== resource.version ||
        provenance.target !== targetId ||
        provenance.static !== true ||
        provenance.binary?.size !== digest.size ||
        provenance.binary?.sha256 !== digest.sha256
      ) {
        throw new Error(
          `Bubblewrap build provenance does not match the binary for ${targetId}`,
        );
      }
      if (resource.name === "bubblewrap") {
        const sourceArchive = target.bubblewrap.archive;
        if (
          provenance.sourceArchive?.url !== sourceArchive.url ||
          provenance.sourceArchive?.size !== sourceArchive.size ||
          provenance.sourceArchive?.sha256 !== sourceArchive.sha256
        ) {
          throw new Error(
            `Bubblewrap build provenance does not match the pinned source for ${targetId}`,
          );
        }
      }
      const provenanceDestination = `provenance/${resource.name}.json`;
      const provenancePath = join(
        bundleRoot,
        ...provenanceDestination.split("/"),
      );
      await mkdir(dirname(provenancePath), { recursive: true });
      await copyFile(provenanceSource, provenancePath);
      await chmod(provenancePath, 0o644);
      buildProvenance = {
        path: provenanceDestination,
        ...(await fileDigest(provenancePath)),
      };
    }
    const licenses = [];
    for (const license of [...resource.licenses].sort((left, right) =>
      left.destination.localeCompare(right.destination),
    )) {
      const licenseSource = await requireRegularFile(
        sourceRoot,
        license.source,
        `Resource ${resource.name} license source`,
      );
      const licenseDestination = safeRelativePath(
        license.destination,
        `Resource ${resource.name} license destination`,
      );
      const existingLicense = stagedLicenses[licenseDestination];
      if (existingLicense && existingLicense.spdx !== license.spdx) {
        throw new Error(
          `License destination has conflicting SPDX identifiers: ${licenseDestination}`,
        );
      }
      if (!existingLicense) {
        const licensePath = join(bundleRoot, ...licenseDestination.split("/"));
        await mkdir(dirname(licensePath), { recursive: true });
        await copyFile(licenseSource, licensePath);
        await chmod(licensePath, 0o644);
        stagedLicenses[licenseDestination] = {
          path: licenseDestination,
          spdx: license.spdx,
          ...(await fileDigest(licensePath)),
        };
      }
      licenses.push({ path: licenseDestination, spdx: license.spdx });
    }
    stagedResources[resource.name] = {
      path: destination,
      executable: resource.executable,
      version: resource.version,
      sourceUrl: resource.sourceUrl,
      sourceCodeUrl: resource.sourceCodeUrl,
      ...digest,
      licenses,
      ...(buildProvenance ? { buildProvenance } : {}),
    };
    noticeLines.push(`${resource.name} ${resource.version}`);
    noticeLines.push(`Artifact: ${resource.sourceUrl}`);
    noticeLines.push(`Source code: ${resource.sourceCodeUrl}`);
    for (const license of licenses) {
      noticeLines.push(`License: ${license.spdx} (${license.path})`);
    }
    if (buildProvenance) {
      noticeLines.push(`Build provenance: ${buildProvenance.path}`);
    }
    noticeLines.push("");
  }
  const noticesPath = join(bundleRoot, "THIRD_PARTY_NOTICES");
  await writeFile(noticesPath, `${noticeLines.join("\n").trimEnd()}\n`, "utf8");
  await chmod(noticesPath, 0o644);
  const stagedNotices = {
    path: "THIRD_PARTY_NOTICES",
    ...(await fileDigest(noticesPath)),
  };
  const manifest = {
    schemaVersion: 1,
    target: {
      id: target.id,
      os: target.os,
      arch: target.arch,
      rustTarget: target.rustTarget,
      sandboxBackend: target.sandboxBackend,
    },
    projectLicense: stagedProjectLicense,
    thirdPartyNotices: stagedNotices,
    resources: stagedResources,
    licenses: Object.fromEntries(
      Object.entries(stagedLicenses).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  };
  const manifestPath = join(bundleRoot, "resources.json");
  await writeJson(manifestPath, manifest);
  return { target, bundleRoot, manifestPath, manifest };
}

export async function stageNpmPlatformPackage({
  targetId,
  sourceDir,
  outputDir,
  resources,
  projectLicense,
  baseVersion,
  targetManifestPath,
}) {
  const packageRoot = toPath(outputDir);
  await requireEmptyDirectory(packageRoot);
  const targetManifest = await loadTargetManifest(targetManifestPath);
  const target = resolveTarget(targetManifest, targetId);
  const metadata = npmPackageMetadata(target, baseVersion);
  const bundleRoot = join(packageRoot, "vendor", target.rustTarget);
  const staged = await stageRuntimeBundle({
    targetId,
    sourceDir,
    outputDir: bundleRoot,
    resources,
    projectLicense,
    targetManifestPath,
  });
  const packageJson = {
    name: metadata.name,
    version: metadata.version,
    license: "Apache-2.0",
    os: metadata.os,
    cpu: metadata.cpu,
    ...(metadata.libc ? { libc: metadata.libc } : {}),
    files: ["vendor/", "LICENSE", "THIRD_PARTY_NOTICES"],
    publishConfig: { access: "public" },
  };
  const packageJsonPath = join(packageRoot, "package.json");
  await copyFile(
    join(staged.bundleRoot, "LICENSE"),
    join(packageRoot, "LICENSE"),
  );
  await copyFile(
    join(staged.bundleRoot, "THIRD_PARTY_NOTICES"),
    join(packageRoot, "THIRD_PARTY_NOTICES"),
  );
  await writeJson(packageJsonPath, packageJson);
  return {
    ...metadata,
    packageRoot,
    packageJsonPath,
    bundleRoot: staged.bundleRoot,
    manifestPath: staged.manifestPath,
  };
}

export async function stagePyinstallerOnedir({
  targetId,
  sourceDir,
  outputDir,
  resources,
  projectLicense,
  targetManifestPath,
}) {
  const stagingRoot = toPath(outputDir);
  await requireEmptyDirectory(stagingRoot);
  const bundleRoot = join(stagingRoot, "flowent-runtime");
  const staged = await stageRuntimeBundle({
    targetId,
    sourceDir,
    outputDir: bundleRoot,
    resources,
    projectLicense,
    targetManifestPath,
  });
  const binaries = [];
  const data = [];
  for (const resource of Object.values(staged.manifest.resources)) {
    const entry = {
      source: posix.join("flowent-runtime", resource.path),
      destination: posix.join("flowent-runtime", posix.dirname(resource.path)),
    };
    data.push(entry);
    if (resource.buildProvenance) {
      data.push({
        source: posix.join("flowent-runtime", resource.buildProvenance.path),
        destination: posix.join(
          "flowent-runtime",
          posix.dirname(resource.buildProvenance.path),
        ),
      });
    }
  }
  for (const license of Object.values(staged.manifest.licenses)) {
    data.push({
      source: posix.join("flowent-runtime", license.path),
      destination: posix.join("flowent-runtime", posix.dirname(license.path)),
    });
  }
  for (const document of [
    staged.manifest.projectLicense,
    staged.manifest.thirdPartyNotices,
  ]) {
    data.push({
      source: posix.join("flowent-runtime", document.path),
      destination: "flowent-runtime",
    });
  }
  data.push({
    source: "flowent-runtime/resources.json",
    destination: "flowent-runtime",
  });
  binaries.sort((left, right) => left.source.localeCompare(right.source));
  data.sort((left, right) => left.source.localeCompare(right.source));
  const input = {
    schemaVersion: 1,
    target: targetId,
    bundleDirectory: "flowent-runtime",
    binaries,
    data,
  };
  const inputPath = join(stagingRoot, "pyinstaller-input.json");
  await writeJson(inputPath, input);
  return { ...staged, stagingRoot, inputPath, input };
}

export async function stagePythonWheelResources({
  targetId,
  sourceDir,
  packageRoot,
  resources,
  projectLicense,
  targetManifestPath,
}) {
  const root = toPath(packageRoot);
  const bundleRoot = join(root, "python", "flowent_native", "runtime");
  return stageRuntimeBundle({
    targetId,
    sourceDir,
    outputDir: bundleRoot,
    resources,
    projectLicense,
    targetManifestPath,
  });
}

export function relativeStagingPath(stagingRoot, path) {
  return portablePath(relative(toPath(stagingRoot), toPath(path)));
}
