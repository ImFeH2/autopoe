import process from "node:process";

import { parseOptions, runCli } from "../runtime/lib/cli.mjs";
import { stageMainPackage } from "./lib/package.mjs";

await runCli(async () => {
  const options = parseOptions(process.argv.slice(2), ["output"]);
  const result = await stageMainPackage({
    projectRoot: process.cwd(),
    outputDir: options.output,
  });
  console.log(result.outputDir);
});
