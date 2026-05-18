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
});
