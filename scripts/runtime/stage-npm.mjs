import process from "node:process";

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
  const plan = await loadResourcePlan(options.plan);
  const result = await stageNpmPlatformPackage({
    targetId: options.target,
    sourceDir: options.source,
    outputDir: options.output,
    resources: plan.resources,
    projectLicense: plan.projectLicense,
    baseVersion: options.version,
    targetManifestPath: options.manifest,
  });
  console.log(
    JSON.stringify({ alias: result.alias, dependency: result.dependency }),
  );
});
