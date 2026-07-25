import {
  chmod,
  cp,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  loadResourcePlan,
  stageNpmPlatformPackage,
} from "../../runtime/lib/stage.mjs";
import { loadTargetManifest } from "../../runtime/lib/targets.mjs";

async function requireEmptyDirectory(path) {
  await mkdir(path, { recursive: true });
  if ((await readdir(path)).length !== 0) {
    throw new Error(`Staging output must be empty: ${path}`);
  }
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function releasePackageJson(source, optionalDependencies) {
  const excluded = new Set([
    "dependencies",
    "devDependencies",
    "files",
    "lint-staged",
    "optionalDependencies",
    "packageManager",
    "private",
    "scripts",
  ]);
  const result = Object.fromEntries(
    Object.entries(source).filter(([key]) => !excluded.has(key)),
  );
  return {
    ...result,
    private: false,
    files: [
      "bin/",
      "README.md",
      "README.zh-CN.md",
      "LICENSE",
      "THIRD_PARTY_NOTICES",
    ],
    optionalDependencies,
  };
}

export async function stageMainPackage({ projectRoot, outputDir }) {
  const root = resolve(projectRoot);
  const output = resolve(outputDir);
  await requireEmptyDirectory(output);
  const sourcePackage = JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
  );
  const manifest = await loadTargetManifest();
  const optionalDependencies = Object.fromEntries(
    Object.values(manifest.targets)
      .map((target) => [
        target.npm.alias,
        `npm:${target.npm.name}@${sourcePackage.version}-${target.npm.versionTag}`,
      ])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  await cp(join(root, "bin"), join(output, "bin"), { recursive: true });
  for (const file of ["README.md", "README.zh-CN.md", "LICENSE"]) {
    await cp(join(root, file), join(output, file));
  }
  await writeFile(
    join(output, "THIRD_PARTY_NOTICES"),
    "Flowent Third-Party Notices\n\nThe main npm package does not bundle third-party components. Platform packages include their own notices.\n",
    "utf8",
  );
  await writeJson(
    join(output, "package.json"),
    releasePackageJson(sourcePackage, optionalDependencies),
  );
  return { outputDir: output, optionalDependencies };
}

export async function stagePlatformPackage({
  targetId,
  sourceDir,
  planPath,
  applicationDir,
  outputDir,
  baseVersion,
}) {
  const plan = await loadResourcePlan(planPath);
  const staged = await stageNpmPlatformPackage({
    targetId,
    sourceDir,
    outputDir,
    resources: plan.resources,
    projectLicense: plan.projectLicense,
    baseVersion,
  });
  const destination = join(staged.bundleRoot, "flowent");
  await cp(applicationDir, destination, {
    recursive: true,
    dereference: true,
  });
  if (!targetId.startsWith("win32-")) {
    await chmod(join(destination, "flowent"), 0o755);
  }
  return { ...staged, applicationDir: destination };
}
