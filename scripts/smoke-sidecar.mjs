import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const target = spawnSync("rustc", ["--print", "host-tuple"], {
  encoding: "utf8",
}).stdout.trim();
const extension = process.platform === "win32" ? ".exe" : "";
const executable = resolve(
  root,
  "src-tauri",
  "binaries",
  `flowent-agent-${target}${extension}`,
);
const child = spawn(executable, [], { stdio: ["pipe", "pipe", "pipe"] });
const decoder = new TextDecoder();
let stdout = "";
let stderr = "";
let ready = false;
let acknowledged = false;
let settled = false;

const completion = new Promise((resolvePromise, rejectPromise) => {
  const timeout = setTimeout(() => {
    child.kill();
    rejectPromise(new Error("Sidecar smoke test timed out"));
  }, 30_000);

  function finish(error) {
    if (settled) {
      return;
    }
    settled = true;
    clearTimeout(timeout);
    if (error) {
      rejectPromise(error);
    } else {
      resolvePromise();
    }
  }

  function handle(message) {
    if (message.kind === "event" && message.name === "runtime.ready") {
      ready = true;
      if (message.payload?.capabilities?.length !== 0) {
        child.kill();
        finish(new Error("Sidecar exposes unexpected capabilities"));
        return;
      }
      child.stdin.write(
        `${JSON.stringify({
          protocol_version: 1,
          id: "shutdown",
          kind: "request",
          name: "runtime.shutdown",
          payload: {},
        })}\n`,
      );
      return;
    }
    if (message.kind === "response" && message.reply_to === "shutdown") {
      acknowledged = true;
      child.stdin.end();
    }
  }

  child.stdout.on("data", (chunk) => {
    stdout += decoder.decode(chunk, { stream: true });
    const lines = stdout.split("\n");
    stdout = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) {
        handle(JSON.parse(line));
      }
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr += decoder.decode(chunk, { stream: true });
  });
  child.on("error", finish);
  child.on("exit", (code) => {
    if (code !== 0) {
      finish(new Error(`Sidecar exited with code ${code}: ${stderr}`));
      return;
    }
    if (!ready || !acknowledged) {
      finish(new Error("Sidecar lifecycle handshake was incomplete"));
      return;
    }
    finish();
  });
});

await completion;
process.stdout.write("Sidecar smoke test passed\n");
