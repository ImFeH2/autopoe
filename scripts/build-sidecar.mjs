import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const agent = resolve(root, "agent");
const binaries = resolve(root, "src-tauri", "binaries");
const isE2e = process.argv.includes("--e2e");
const variant = isE2e ? "sidecar-e2e" : "sidecar";
const dist = resolve(agent, "dist", variant);
const work = resolve(agent, "build", variant);

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
  {
    cwd: agent,
    env: {
      ...process.env,
      FLOWENT_SIDECAR_BUILD: isE2e ? "e2e" : "production",
    },
  },
);

const analysis = readFileSync(
  resolve(work, "flowent-agent", "Analysis-00.toc"),
  "utf8",
);
if (!isE2e && analysis.includes("e2e_support")) {
  throw new Error("Production Sidecar contains E2E support modules");
}
if (isE2e && !analysis.includes("e2e_support.runner")) {
  throw new Error("E2E Sidecar does not contain its test runner");
}

const source = resolve(dist, `flowent-agent${extension}`);
const binaryBase = isE2e ? "flowent-agent-e2e" : "flowent-agent";
const destination = resolve(binaries, `${binaryBase}-${target}${extension}`);
copyFileSync(source, destination);
if (process.platform !== "win32") {
  chmodSync(destination, 0o755);
}

const smokeData = mkdtempSync(join(tmpdir(), "flowent-sidecar-smoke-"));
let smoke;
try {
  smoke = spawnSync(destination, [], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, FLOWENT_DATA_DIR: smokeData },
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
    smoke.error ?? new Error(`Sidecar smoke exited with status ${smoke.status}`)
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
  throw new Error("Sidecar smoke returned an invalid response");
}

process.stdout.write(`${destination}\n`);
