import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { validateResourcePlan } from "./stage.mjs";

const semanticVersion =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function createRuntimeResourcePlan(target, version) {
  if (typeof version !== "string" || !semanticVersion.test(version)) {
    throw new Error("Release version must be a valid semantic version");
  }
  const resources = [
    {
      name: "ripgrep",
      source: "bin/rg{exe}",
      destination: "bin/rg{exe}",
      executable: true,
      version: target.ripgrep.version,
      sourceUrl: target.ripgrep.archive.url,
      sourceCodeUrl: `https://github.com/BurntSushi/ripgrep/tree/${target.ripgrep.version}`,
      licenses: [
        {
          spdx: "MIT",
          source: "licenses/ripgrep-MIT.txt",
          destination: "licenses/ripgrep-MIT.txt",
        },
        {
          spdx: "Unlicense",
          source: "licenses/ripgrep-UNLICENSE.txt",
          destination: "licenses/ripgrep-UNLICENSE.txt",
        },
      ],
    },
  ];
  if (target.os === "win32") {
    resources.unshift({
      name: "flowent-native",
      source: "bin/flowent-native{exe}",
      destination: "bin/flowent-native{exe}",
      executable: true,
      version,
      sourceUrl: `https://github.com/ImFeH2/flowent/releases/tag/v${version}`,
      sourceCodeUrl: `https://github.com/ImFeH2/flowent/tree/v${version}`,
      licenses: [
        {
          spdx: "Apache-2.0",
          source: "LICENSE",
          destination: "licenses/flowent-native-Apache-2.0.txt",
        },
      ],
    });
  }
  if (target.bubblewrap) {
    resources.push({
      name: "bubblewrap",
      targets: [target.id],
      source: "bin/bwrap",
      destination: "bin/bwrap",
      executable: true,
      version: target.bubblewrap.version,
      sourceUrl: target.bubblewrap.archive.url,
      sourceCodeUrl: target.bubblewrap.sourceCodeUrl,
      buildProvenance: "provenance/bubblewrap.json",
      licenses: [
        {
          spdx: target.bubblewrap.licenseSpdx,
          source: "licenses/bubblewrap-COPYING",
          destination: "licenses/bubblewrap-COPYING",
        },
      ],
    });
  }
  return validateResourcePlan({
    schemaVersion: 1,
    projectLicense: { source: "LICENSE", spdx: "Apache-2.0" },
    resources,
  });
}

export async function writeRuntimeResourcePlan({
  target,
  version,
  outputPath,
}) {
  const plan = createRuntimeResourcePlan(target, version);
  const resolvedOutput = resolve(outputPath);
  await mkdir(dirname(resolvedOutput), { recursive: true });
  await writeFile(resolvedOutput, `${JSON.stringify(plan, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  return { outputPath: resolvedOutput, plan };
}
