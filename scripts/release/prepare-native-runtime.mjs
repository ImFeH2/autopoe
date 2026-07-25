import process from "node:process";

import { parseOptions, runCli } from "../runtime/lib/cli.mjs";
import { prepareNativeRuntime } from "./lib/native-runtime.mjs";

await runCli(async () => {
  const options = parseOptions(process.argv.slice(2), [
    "target",
    "output",
    "version",
  ]);
  const result = await prepareNativeRuntime({
    targetId: options.target,
    nativeBinary: options.native,
    outputDir: options.output,
    version: options.version,
    compiler: options.cc,
    tarCommand: options.tar,
  });
  console.log(result.planPath);
});
