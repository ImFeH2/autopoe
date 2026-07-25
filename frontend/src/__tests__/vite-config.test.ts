import { describe, expect, it } from "vitest";
import { loadConfigFromFile } from "vite";

describe("vite config", () => {
  it("proxies API requests to the local app server", async () => {
    const loadedConfig = await loadConfigFromFile(
      { command: "serve", mode: "development" },
      "vite.config.ts",
    );

    expect(loadedConfig?.config.server?.proxy?.["/api"]).toMatchObject({
      target: "http://localhost:6874",
    });
  });

  it("reads the dev server host from the environment", async () => {
    const previousHost = process.env.FLOWENT_FRONTEND_HOST;
    process.env.FLOWENT_FRONTEND_HOST = "0.0.0.0";

    try {
      const loadedConfig = await loadConfigFromFile(
        { command: "serve", mode: "development" },
        "vite.config.ts",
      );

      expect(loadedConfig?.config.server?.host).toBe("0.0.0.0");
    } finally {
      if (previousHost === undefined) {
        delete process.env.FLOWENT_FRONTEND_HOST;
      } else {
        process.env.FLOWENT_FRONTEND_HOST = previousHost;
      }
    }
  });

  it("sets an explicit modern browser support target", async () => {
    const loadedConfig = await loadConfigFromFile(
      { command: "build", mode: "production" },
      "vite.config.ts",
    );

    expect(loadedConfig?.config.build?.target).toEqual([
      "chrome111",
      "edge111",
      "firefox114",
      "safari16.4",
      "ios16.4",
    ]);
  });
});

describe("vitest config", () => {
  it("caps parallel test workers for stable application loading", async () => {
    const loadedConfig = await loadConfigFromFile(
      { command: "serve", mode: "test" },
      "vitest.config.ts",
    );
    const testConfig = (
      loadedConfig?.config as {
        test?: { fileParallelism?: boolean; maxWorkers?: number | string };
      }
    ).test;

    expect(testConfig).toMatchObject({
      fileParallelism: true,
      maxWorkers: 4,
    });
  });
});
