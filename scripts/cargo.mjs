import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const manifest = resolve(root, "app", "src-tauri", "Cargo.toml");
const args = process.argv.slice(2);
if (args.length === 0) {
  throw new Error("Expected a Cargo command");
}

const separator = args.indexOf("--");
const cargoArgs =
  separator === -1
    ? [...args, "--manifest-path", manifest]
    : [
        ...args.slice(0, separator),
        "--manifest-path",
        manifest,
        ...args.slice(separator),
      ];
const command = process.platform === "win32" ? "cargo.exe" : "cargo";
const child = spawn(command, cargoArgs, {
  cwd: root,
  env: {
    ...process.env,
    TAURI_CONFIG: JSON.stringify({ bundle: { externalBin: [] } }),
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
