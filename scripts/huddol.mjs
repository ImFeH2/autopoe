import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const core = resolve(root, "huddol");
const args = process.argv.slice(2);
if (args.length === 0) {
  throw new Error("Expected a Huddol command");
}

const command = process.platform === "win32" ? "uv.exe" : "uv";
const child = spawn(command, ["run", ...args], {
  cwd: core,
  env: process.env,
  stdio: "inherit",
});

const exitCode = await new Promise((resolveExit, reject) => {
  child.once("error", reject);
  child.once("close", (code) => resolveExit(code));
});

if (exitCode !== 0) {
  process.exitCode = typeof exitCode === "number" ? exitCode : 1;
}
