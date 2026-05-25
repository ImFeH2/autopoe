import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import assert from "node:assert/strict";

const repositoryRoot = new URL("..", import.meta.url).pathname;
const flowentBin = join(repositoryRoot, "bin", "flowent.mjs");

test("flowent CLI runs backend from the caller working directory", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "flowent-cli-"));
  const workspace = join(tempRoot, "workspace");
  const uvStub = join(tempRoot, "uv-stub");
  const recordPath = join(tempRoot, "record.json");
  mkdirSync(workspace);

  writeFileSync(
    uvStub,
    `#!/usr/bin/env node\nconst { writeFileSync } = require("node:fs");\nwriteFileSync(process.env.FLOWENT_TEST_RECORD, JSON.stringify({ cwd: process.cwd(), argv: process.argv.slice(2) }));\n`,
  );
  chmodSync(uvStub, 0o755);

  execFileSync("node", [flowentBin, "--version"], {
    cwd: workspace,
    env: {
      ...process.env,
      FLOWENT_TEST_RECORD: recordPath,
      FLOWENT_UV_BINARY: uvStub,
    },
    stdio: "pipe",
  });

  const record = JSON.parse(readFileSync(recordPath, "utf8"));
  assert.equal(record.cwd, workspace);
  assert.deepEqual(record.argv.slice(0, 3), [
    "run",
    "--project",
    join(repositoryRoot, "backend"),
  ]);
});
