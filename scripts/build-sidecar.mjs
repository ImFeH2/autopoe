import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const agent = resolve(root, "agent");
const binaries = resolve(root, "src-tauri", "binaries");
const dist = resolve(agent, "dist", "sidecar");
const work = resolve(agent, "build", "sidecar");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
}

function output(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) {
    throw (
      result.error ??
      new Error(`${command} exited with status ${result.status}`)
    );
  }
  return result.stdout.trim();
}

const target =
  process.env.TAURI_ENV_TARGET_TRIPLE ||
  output("rustc", ["--print", "host-tuple"]);
const extension = process.platform === "win32" ? ".exe" : "";

mkdirSync(binaries, { recursive: true });
run(
  "uv",
  [
    "run",
    "--project",
    agent,
    "pyinstaller",
    "--noconfirm",
    "--clean",
    "--distpath",
    dist,
    "--workpath",
    work,
    resolve(agent, "flowent-agent.spec"),
  ],
  { cwd: agent },
);

const source = resolve(dist, `flowent-agent${extension}`);
const destination = resolve(binaries, `flowent-agent-${target}${extension}`);
copyFileSync(source, destination);
if (process.platform !== "win32") {
  chmodSync(destination, 0o755);
}
process.stdout.write(`${destination}\n`);
