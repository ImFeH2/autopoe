import process from "node:process";

import { parseOptions, runCli } from "./lib/cli.mjs";
import { downloadVerified } from "./lib/download.mjs";
import { loadTargetManifest, resolveTarget } from "./lib/targets.mjs";

await runCli(async () => {
  const options = parseOptions(process.argv.slice(2), ["target", "output"]);
  const manifest = await loadTargetManifest(options.manifest);
  const target = resolveTarget(manifest, options.target);
  const result = await downloadVerified({
    url: target.ripgrep.archive.url,
    destination: options.output,
    size: target.ripgrep.archive.size,
    sha256: target.ripgrep.archive.sha256,
  });
  console.log(result.path);
});
