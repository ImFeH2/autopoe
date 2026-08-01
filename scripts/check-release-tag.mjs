import { readFileSync } from "node:fs";

const manifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const expected = `v${manifest.version}`;
const actual = process.env.GITHUB_REF_NAME;

if (actual !== expected) {
  throw new Error(
    `Release tag ${actual ?? "<missing>"} does not match ${expected}`,
  );
}
