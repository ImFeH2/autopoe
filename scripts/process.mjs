import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

export function binary(name) {
  return process.platform === "win32" ? `${name}.exe` : name;
}

export async function run(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    ...options,
  });
  const code = await new Promise((settle, reject) => {
    child.once("error", reject);
    child.once("close", settle);
  });
  if (code !== 0) {
    process.exitCode = typeof code === "number" ? code : 1;
  }
  return code ?? 1;
}
