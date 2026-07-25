import process from "node:process";

import { parseOptions, runCli } from "./lib/cli.mjs";
import { loadResourcePlan, stagePythonWheelResources } from "./lib/stage.mjs";

await runCli(async () => {
  const options = parseOptions(process.argv.slice(2), [
    "target",
    "source",
    "plan",
    "package-root",
  ]);
  const plan = await loadResourcePlan(options.plan);
  const result = await stagePythonWheelResources({
    targetId: options.target,
    sourceDir: options.source,
    packageRoot: options["package-root"],
    resources: plan.resources,
    projectLicense: plan.projectLicense,
    targetManifestPath: options.manifest,
  });
  console.log(result.manifestPath);
});
