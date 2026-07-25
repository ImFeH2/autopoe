import { configDefaults, defineConfig, mergeConfig } from "vitest/config";

import viteConfig from "./vite.config";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      exclude: [...configDefaults.exclude, "dist/**"],
      setupFiles: ["./src/test/setup.ts"],
      css: true,
      clearMocks: true,
      restoreMocks: true,
      fileParallelism: false,
      testTimeout: 15_000,
    },
  }),
);
