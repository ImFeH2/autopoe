import process from "node:process";

import { buildBubblewrap } from "./lib/bubblewrap.mjs";
import { parseOptions, runCli } from "./lib/cli.mjs";
import { loadTargetManifest, resolveTarget } from "./lib/targets.mjs";

await runCli(async () => {
  const options = parseOptions(process.argv.slice(2), [
    "target",
    "archive",
    "output",
  ]);
  const manifest = await loadTargetManifest(options.manifest);
  const target = resolveTarget(manifest, options.target);
  const result = await buildBubblewrap({
    target,
    archivePath: options.archive,
    outputDir: options.output,
    compiler: options.cc,
    tar: options.tar,
  });
  console.log(result.binaryPath);
});
