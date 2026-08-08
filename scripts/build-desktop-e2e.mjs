import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const targetDir = resolve(rootDir, "src-tauri", "target", "desktop-e2e");
const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const child = spawn(
  packageManager,
  [
    "tauri",
    "build",
    "--debug",
    "--no-bundle",
    "--features",
    "desktop-e2e",
    "--config",
    "src-tauri/tauri.e2e.conf.json",
  ],
  {
    cwd: rootDir,
    env: { ...process.env, CARGO_TARGET_DIR: targetDir },
    stdio: "inherit",
  },
);

const exitCode = await new Promise((resolveExit, reject) => {
  child.once("error", reject);
  child.once("close", (code) => resolveExit(code));
});

if (exitCode !== 0) {
  process.exitCode = typeof exitCode === "number" ? exitCode : 1;
}
