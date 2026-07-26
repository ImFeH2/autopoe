import process from "node:process";
import { readFile } from "node:fs/promises";

import { parseOptions, runCli } from "./lib/cli.mjs";
import { loadResourcePlan, stageNpmPlatformPackage } from "./lib/stage.mjs";

await runCli(async () => {
  const options = parseOptions(process.argv.slice(2), [
    "target",
    "source",
    "plan",
    "output",
    "version",
  ]);
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  const plan = await loadResourcePlan(options.plan);
  const result = await stageNpmPlatformPackage({
    targetId: options.target,
    sourceDir: options.source,
    outputDir: options.output,
    resources: plan.resources,
    projectLicense: plan.projectLicense,
    baseVersion: options.version,
    repository: packageJson.repository,
    targetManifestPath: options.manifest,
  });
  console.log(
    JSON.stringify({ alias: result.alias, dependency: result.dependency }),
  );
});
