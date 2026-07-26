import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";

import { parseOptions, runCli } from "../runtime/lib/cli.mjs";
import {
  loadResourcePlan,
  stagePyinstallerOnedir,
} from "../runtime/lib/stage.mjs";
import { stagePlatformPackage } from "./lib/package.mjs";
import { buildPyinstallerOnedir } from "./lib/pyinstaller.mjs";

await runCli(async () => {
  const options = parseOptions(process.argv.slice(2), [
    "target",
    "source",
    "plan",
    "work",
    "output",
    "version",
  ]);
  const projectRoot = process.cwd();
  const packageJson = JSON.parse(
    await readFile(join(projectRoot, "package.json"), "utf8"),
  );
  const workRoot = resolve(options.work);
  await mkdir(workRoot, { recursive: true });
  let applicationDir = options.application;
  if (!applicationDir) {
    const plan = await loadResourcePlan(options.plan);
    const runtime = await stagePyinstallerOnedir({
      targetId: options.target,
      sourceDir: options.source,
      outputDir: join(workRoot, "runtime"),
      resources: plan.resources,
      projectLicense: plan.projectLicense,
    });
    const application = await buildPyinstallerOnedir({
      targetId: options.target,
      projectRoot,
      inputPath: runtime.inputPath,
      outputDir: join(workRoot, "application"),
      workDir: join(workRoot, "pyinstaller-build"),
      specDir: join(workRoot, "pyinstaller-spec"),
    });
    applicationDir = application.applicationDir;
  }
  const staged = await stagePlatformPackage({
    targetId: options.target,
    sourceDir: options.source,
    planPath: options.plan,
    applicationDir,
    outputDir: options.output,
    baseVersion: options.version,
    repository: packageJson.repository,
  });
  console.log(
    JSON.stringify({ alias: staged.alias, packageRoot: staged.packageRoot }),
  );
});
