import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";

import { parseOptions, runCli } from "../runtime/lib/cli.mjs";
import {
  loadResourcePlan,
  stagePyinstallerOnedir,
} from "../runtime/lib/stage.mjs";

await runCli(async () => {
  const options = parseOptions(process.argv.slice(2), [
    "target",
    "source",
    "plan",
    "work",
  ]);
  const workRoot = resolve(options.work);
  await mkdir(workRoot, { recursive: true });
  const plan = await loadResourcePlan(options.plan);
  const runtime = await stagePyinstallerOnedir({
    targetId: options.target,
    sourceDir: options.source,
    outputDir: join(workRoot, "runtime"),
    resources: plan.resources,
    projectLicense: plan.projectLicense,
  });
  console.log(runtime.inputPath);
});
