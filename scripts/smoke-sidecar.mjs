import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
const dataDir = mkdtempSync(join(tmpdir(), "flowent-sidecar-"));
const child = spawn(executable, [], { stdio: ["pipe", "pipe", "pipe"] });
const decoder = new TextDecoder();
let stdout = "";
let stderr = "";
let output = "";
let settled = false;

function request(id, name, payload) {
  child.stdin.write(
    `${JSON.stringify({
      protocol_version: 1,
      id,
      kind: "request",
      name,
      payload,
    })}\n`,
  );
}

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

  function handle(envelope) {
    if (envelope.name === "runtime.error") {
      finish(new Error(envelope.payload?.message ?? "Runtime error"));
      return;
    }
    if (envelope.kind === "event" && envelope.name === "runtime.hello") {
      request("initialize", "runtime.initialize", { data_dir: dataDir });
      return;
    }
    if (envelope.kind === "event" && envelope.name === "runtime.ready") {
      request("agent", "agent.run", {
        run_id: "smoke-agent",
        messages: [{ role: "user", content: "Frozen sidecar smoke test" }],
      });
      return;
    }
    if (envelope.kind === "event" && envelope.name === "agent.text_delta") {
      output += envelope.payload?.delta ?? "";
      return;
    }
    if (envelope.kind === "event" && envelope.name === "agent.completed") {
      if (!output.includes("Frozen sidecar smoke test")) {
        finish(new Error("Sidecar did not stream the expected output"));
        return;
      }
      request("shutdown", "runtime.shutdown", {});
      return;
    }
    if (envelope.kind === "response" && envelope.reply_to === "shutdown") {
      finish();
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
    if (!settled) {
      finish(new Error(`Sidecar exited with code ${code}: ${stderr}`));
    }
  });
});

try {
  await completion;
  process.stdout.write("Sidecar smoke test passed\n");
} finally {
  child.stdin.end();
  rmSync(dataDir, { force: true, recursive: true });
}
