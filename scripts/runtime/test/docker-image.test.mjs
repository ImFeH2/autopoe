import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";

const execute = promisify(execFile);
const image = process.env.FLOWENT_TEST_IMAGE;

async function docker(...args) {
  return execute("docker", args, { encoding: "utf8" });
}

test("production image runs directly as the Flowent user", {
  skip: !image,
}, async () => {
  const { stdout } = await docker("image", "inspect", image);
  const [{ Config }] = JSON.parse(stdout);
  assert.deepEqual(Config.Cmd, ["/app/backend/.venv/bin/flowent"]);
  assert.equal(Config.User, "flowent");
  assert.equal(Config.WorkingDir, "/workspace");
  assert.ok(Config.Env.includes("FLOWENT_STATIC_DIR=/app/frontend"));
  assert.ok(Config.Env.includes("FLOWENT_SYSTEM_RUNTIME=1"));
});

test("production image includes runtime tools without uv", {
  skip: !image,
}, async () => {
  const probe = [
    "set -eu",
    "! command -v uv",
    "bwrap --version",
    "rg --version",
    "flowent --version",
    "flowent doctor",
    "test -f /app/frontend/index.html",
    "test -d /home/flowent/.flowent",
    "test -d /workspace",
    'test "$(id -u)" = "1001"',
  ].join("\n");
  const { stdout } = await docker(
    "run",
    "--rm",
    "--security-opt",
    "seccomp=unconfined",
    "--security-opt",
    "apparmor=unconfined",
    "--entrypoint",
    "sh",
    image,
    "-c",
    probe,
  );
  assert.match(stdout, /bubblewrap \d+/);
  assert.match(stdout, /ripgrep \d+/);
  assert.match(stdout, /flowent \d+/);
});

test("production image fails closed without namespace permissions", {
  skip: !image,
}, async () => {
  await assert.rejects(
    docker(
      "run",
      "--rm",
      "--entrypoint",
      "/app/backend/.venv/bin/flowent",
      image,
      "doctor",
    ),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /Command protection: unavailable/);
      return true;
    },
  );
});

test("production image protects commands and file search", {
  skip: !image,
}, async () => {
  const probe = [
    "from pathlib import Path",
    "from flowent.sandbox import SandboxRunner",
    "from flowent.system_tools import ensure_ripgrep_available",
    'runner = SandboxRunner(cwd=Path("/workspace"))',
    'read = runner.run(["/bin/sh", "-c", "head -n 1 /etc/os-release"])',
    'search = runner.run([ensure_ripgrep_available(), "--fixed-strings", "Flowent", "/app/backend/README.md"])',
    "assert read.exit_code == 0, (read.stderr, read.failure)",
    "assert search.exit_code == 0, (search.stderr, search.failure)",
    "print(read.stdout.strip())",
    "print(search.stdout.strip())",
  ].join("; ");
  const { stdout } = await docker(
    "run",
    "--rm",
    "--security-opt",
    "seccomp=unconfined",
    "--security-opt",
    "apparmor=unconfined",
    "--entrypoint",
    "/app/backend/.venv/bin/python",
    image,
    "-c",
    probe,
  );

  assert.match(stdout, /PRETTY_NAME=/);
  assert.match(stdout, /Flowent/);
});
