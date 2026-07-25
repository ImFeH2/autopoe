import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const composeUrl = new URL("../../../docker-compose.yml", import.meta.url);

test("production Compose enables the namespaces required by command protection", async () => {
  const source = await readFile(composeUrl, "utf8");

  assert.match(source, /^ {4}security_opt:\n {6}- seccomp=unconfined$/m);
  assert.match(source, /^ {6}- apparmor=unconfined$/m);
});
