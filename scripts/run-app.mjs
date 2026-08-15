import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const app = resolve(root, "app");
const action = process.argv[2];
if (action !== "dev" && action !== "build") {
  throw new Error("Expected app action: dev or build");
}

const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const child = spawn(packageManager, ["--dir", app, "tauri", action], {
  cwd: root,
  env: {
    ...process.env,
    FLOWENT_WORKING_DIRECTORY: process.cwd(),
  },
  stdio: "inherit",
});

const exitCode = await new Promise((resolveExit, reject) => {
  child.once("error", reject);
  child.once("close", (code) => resolveExit(code));
});

if (exitCode !== 0) {
  process.exitCode = typeof exitCode === "number" ? exitCode : 1;
}
