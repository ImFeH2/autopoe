import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const testDirectory = import.meta.dirname;

test("Python freeze builder contract", async () => {
  const result = await execFileAsync(
    process.env.PYTHON ?? "python",
    ["-m", "unittest", "discover", "-s", testDirectory, "-p", "*_test.py"],
    {
      cwd: join(testDirectory, "..", "..", ".."),
    },
  );

  assert.match(result.stderr, /OK/);
});
