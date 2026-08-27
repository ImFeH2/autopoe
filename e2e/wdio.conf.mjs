import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const artifactDir = resolve(rootDir, "artifacts", "e2e");
const screenshotDir = resolve(artifactDir, "screenshots");
const binaryName =
  process.platform === "win32" ? "huddol-app.exe" : "huddol-app";
const appBinary = resolve(
  rootDir,
  "app",
  "src-tauri",
  "target",
  "huddol-debug",
  "debug",
  binaryName,
);

export const config = {
  runner: "local",
  specs: [resolve(rootDir, "e2e", "specs", "**", "*.e2e.mjs")],
  maxInstances: 1,
  capabilities: [
    {
      browserName: "tauri",
      "tauri:options": {
        application: appBinary,
      },
    },
  ],
  services: [
    [
      "@wdio/tauri-service",
      {
        captureBackendLogs: true,
        captureFrontendLogs: true,
        driverProvider: "embedded",
        logDir: resolve(artifactDir, "logs"),
      },
    ],
  ],
  framework: "mocha",
  reporters: ["spec"],
  outputDir: resolve(artifactDir, "logs"),
  logLevel: "warn",
  waitforTimeout: 10_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 1,
  mochaOpts: {
    timeout: 30_000,
    ui: "bdd",
  },
  afterTest: async (test, _context, result) => {
    if (result.passed) {
      return;
    }
    mkdirSync(screenshotDir, { recursive: true });
    const name = `${test.parent ?? "desktop"}-${test.title}`
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, "-")
      .replaceAll(/^-|-$/g, "");
    await browser.saveScreenshot(resolve(screenshotDir, `${name}.png`));
  },
};
