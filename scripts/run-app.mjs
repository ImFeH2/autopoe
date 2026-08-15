import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const app = resolve(root, "app");
const [action, ...args] = process.argv.slice(2);
if (action !== "dev" && action !== "build") {
  throw new Error("Expected app action: dev or build");
}

const require = createRequire(resolve(app, "package.json"));
const tauriCli = require.resolve("@tauri-apps/cli/tauri.js");
const child = spawn(process.execPath, [tauriCli, action, ...args], {
  cwd: app,
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
