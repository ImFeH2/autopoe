import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const app = resolve(root, "app");
const core = resolve(root, "core");
const [action, ...args] = process.argv.slice(2);
if (action !== "dev" && action !== "build") {
  throw new Error("Expected app action: dev or build");
}

function findUv() {
  const candidates = [
    process.env.UV,
    resolve(
      homedir(),
      ".local",
      "bin",
      process.platform === "win32" ? "uv.exe" : "uv",
    ),
    resolve(
      homedir(),
      ".cargo",
      "bin",
      process.platform === "win32" ? "uv.exe" : "uv",
    ),
  ];
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    candidates.push(
      resolve(
        process.env.LOCALAPPDATA,
        "Microsoft",
        "WinGet",
        "Links",
        "uv.exe",
      ),
    );
    const packages = resolve(
      process.env.LOCALAPPDATA,
      "Microsoft",
      "WinGet",
      "Packages",
    );
    if (existsSync(packages)) {
      for (const entry of readdirSync(packages)) {
        if (entry.startsWith("astral-sh.uv_")) {
          candidates.push(resolve(packages, entry, "uv.exe"));
        }
      }
    }
  }
  return candidates.find((candidate) => candidate && existsSync(candidate));
}

const env = { ...process.env };
if (action === "dev") {
  const uv = findUv() ?? (process.platform === "win32" ? "uv.exe" : "uv");
  const sync = spawnSync(uv, ["sync", "--project", core], {
    cwd: root,
    stdio: "inherit",
  });
  if (sync.error) {
    throw sync.error;
  }
  if (sync.status !== 0) {
    throw new Error(`${uv} exited with status ${sync.status}`);
  }
  const python = resolve(
    core,
    ".venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
  if (!existsSync(python)) {
    throw new Error(`Huddol development Python not found: ${python}`);
  }
  env.HUDDOL_DEVELOPMENT_PYTHON = python;
}

const require = createRequire(resolve(app, "package.json"));
const tauriCli = require.resolve("@tauri-apps/cli/tauri.js");
const child = spawn(process.execPath, [tauriCli, action, ...args], {
  cwd: app,
  env,
  stdio: "inherit",
});

const exitCode = await new Promise((resolveExit, reject) => {
  child.once("error", reject);
  child.once("close", (code) => resolveExit(code));
});

if (exitCode !== 0) {
  process.exitCode = typeof exitCode === "number" ? exitCode : 1;
}
