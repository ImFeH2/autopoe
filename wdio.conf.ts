import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TauriCapabilities } from "@wdio/tauri-service";

const rootDir = dirname(fileURLToPath(import.meta.url));
const artifactsDir = join(rootDir, "artifacts", "desktop");
const logsDir = join(artifactsDir, "logs");
const stateDir = join(artifactsDir, "e2e-state");
mkdirSync(logsDir, { recursive: true });

const binaryName = process.platform === "win32" ? "flowent.exe" : "flowent";
const application = join(
  rootDir,
  "src-tauri",
  "target",
  "desktop-e2e",
  "debug",
  binaryName,
);
const capability: TauriCapabilities = {
  browserName: "tauri",
  "tauri:options": { application },
};

export const config: WebdriverIO.Config = {
  runner: "local",
  tsConfigPath: "./tsconfig.e2e.json",
  specs: ["./e2e/**/*.e2e.ts"],
  maxInstances: 1,
  capabilities: [capability],
  services: [
    [
      "@wdio/tauri-service",
      {
        appBinaryPath: application,
        driverProvider: "embedded",
        captureBackendLogs: true,
        captureFrontendLogs: true,
        backendLogLevel: "debug",
        frontendLogLevel: "debug",
        logDir: logsDir,
        startTimeout: 60_000,
        statusPollTimeout: 5_000,
      },
    ],
  ],
  framework: "mocha",
  reporters: ["spec"],
  outputDir: logsDir,
  logLevel: "info",
  waitforTimeout: 10_000,
  connectionRetryTimeout: 90_000,
  connectionRetryCount: 1,
  mochaOpts: {
    ui: "bdd",
    timeout: 60_000,
  },
  onPrepare: () => {
    rmSync(stateDir, { force: true, recursive: true });
  },
};
