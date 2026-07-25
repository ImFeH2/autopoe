import process from "node:process";

import { parseOptions, runCli } from "./lib/cli.mjs";
import { loadResourcePlan, stagePyinstallerOnedir } from "./lib/stage.mjs";

await runCli(async () => {
  const options = parseOptions(process.argv.slice(2), [
    "target",
    "source",
    "plan",
    "output",
  ]);
  const plan = await loadResourcePlan(options.plan);
  const result = await stagePyinstallerOnedir({
    targetId: options.target,
    sourceDir: options.source,
    outputDir: options.output,
    resources: plan.resources,
    projectLicense: plan.projectLicense,
    targetManifestPath: options.manifest,
  });
  console.log(result.inputPath);
});
