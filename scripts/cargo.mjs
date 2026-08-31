import { resolve } from "node:path";
import { binary, root, run } from "./process.mjs";

const manifest = resolve(root, "app", "src-tauri", "Cargo.toml");
const args = process.argv.slice(2);
if (args.length === 0) {
  throw new Error("Expected a Cargo command");
}

const separator = args.indexOf("--");
const withManifest =
  separator === -1
    ? [...args, "--manifest-path", manifest]
    : [
        ...args.slice(0, separator),
        "--manifest-path",
        manifest,
        ...args.slice(separator),
      ];

// Clearing externalBin lets cargo check and clippy run before the sidecar
// binary has been built.
await run(binary("cargo"), withManifest, {
  env: {
    ...process.env,
    TAURI_CONFIG: JSON.stringify({ bundle: { externalBin: [] } }),
  },
});
