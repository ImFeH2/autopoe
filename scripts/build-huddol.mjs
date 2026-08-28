import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const core = resolve(root, "huddol");
const binaries = resolve(root, "app", "src-tauri", "binaries");
const dist = resolve(core, "dist");
const work = resolve(core, "build");

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
    core,
    "pyinstaller",
    "--noconfirm",
    "--clean",
    "--distpath",
    dist,
    "--workpath",
    work,
    resolve(core, "huddol.spec"),
  ],
  { cwd: core },
);

const source = resolve(dist, `huddol${extension}`);
const destination = resolve(binaries, `huddol-${target}${extension}`);
copyFileSync(source, destination);
if (process.platform !== "win32") {
  chmodSync(destination, 0o755);
}

const smokeData = mkdtempSync(join(tmpdir(), "huddol-smoke-"));
let smoke;
try {
  smoke = spawnSync(destination, [], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, HUDDOL_DATA_DIR: smokeData },
    input:
      '{"id":1,"method":"organization.get","params":{}}\n' +
      '{"id":2,"method":"system.shutdown","params":{}}\n',
    timeout: 15_000,
  });
} finally {
  rmSync(smokeData, { force: true, recursive: true });
}
if (smoke.error || smoke.status !== 0) {
  throw (
    smoke.error ?? new Error(`Huddol smoke exited with status ${smoke.status}`)
  );
}
const responses = smoke.stdout
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
if (
  responses.length !== 2 ||
  responses[0].id !== 1 ||
  responses[0].result?.organization?.id !== 1 ||
  responses[1].id !== 2 ||
  responses[1].result?.stopped !== true
) {
  throw new Error("Huddol smoke returned an invalid response");
}

process.stdout.write(`${destination}\n`);
