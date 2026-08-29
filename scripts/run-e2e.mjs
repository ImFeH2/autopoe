import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const artifactDir = resolve(rootDir, "artifacts", "e2e");
const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const specs = [
  "e2e/specs/startup.e2e.mjs",
  "e2e/specs/execution-settings.e2e.mjs",
  "e2e/specs/members.e2e.mjs",
  "e2e/specs/discussion.e2e.mjs",
  "e2e/specs/discussion-shell-trace.e2e.mjs",
];

rmSync(artifactDir, { force: true, recursive: true });
let failed = false;
for (const spec of specs) {
  const dataDirectory = mkdtempSync(resolve(tmpdir(), "huddol-e2e-"));
  try {
    const result = spawnSync(
      packageManager,
      [
        "exec",
        "wdio",
        "run",
        "e2e/wdio.conf.mjs",
        "--spec",
        resolve(rootDir, spec),
      ],
      {
        cwd: rootDir,
        env: {
          ...process.env,
          HUDDOL_DATA_DIR: dataDirectory,
          HUDDOL_E2E_WRITABLE_DIRECTORY: rootDir,
        },
        stdio: "inherit",
      },
    );
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      failed = true;
    }
  } finally {
    rmSync(dataDirectory, { force: true, recursive: true });
  }
}

if (failed) {
  process.exitCode = 1;
}
