import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const appDir = resolve(rootDir, "app");
const targetDir = resolve(appDir, "src-tauri", "target", "huddol-debug");
const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const child = spawn(
  packageManager,
  [
    "--dir",
    appDir,
    "tauri",
    "build",
    "--debug",
    "--no-bundle",
    "--features",
    "debug",
    "--config",
    "src-tauri/tauri.debug.conf.json",
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
