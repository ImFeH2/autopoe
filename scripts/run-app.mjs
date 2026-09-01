import { createRequire } from "node:module";
import { resolve } from "node:path";
import { root, run } from "./process.mjs";

const app = resolve(root, "app");
const [action, ...args] = process.argv.slice(2);
if (action !== "dev" && action !== "build") {
  throw new Error("Expected app action: dev or build");
}

const require = createRequire(resolve(app, "package.json"));
const tauriCli = require.resolve("@tauri-apps/cli/tauri.js");
await run(process.execPath, [tauriCli, action, ...args], {
  cwd: app,
  stdio: "inherit",
});
