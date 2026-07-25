import process from "node:process";

import { parseOptions, runCli } from "./lib/cli.mjs";
import { writeRuntimeResourcePlan } from "./lib/plan.mjs";
import { loadTargetManifest, resolveTarget } from "./lib/targets.mjs";

await runCli(async () => {
  const options = parseOptions(process.argv.slice(2), [
    "target",
    "version",
    "output",
  ]);
  const manifest = await loadTargetManifest(options.manifest);
  const result = await writeRuntimeResourcePlan({
    target: resolveTarget(manifest, options.target),
    version: options.version,
    outputPath: options.output,
  });
  console.log(result.outputPath);
});
