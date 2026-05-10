import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const rootDirectory = fileURLToPath(new URL(".", import.meta.url));
const devProxyTarget =
  process.env.VITE_DEV_PROXY_TARGET ?? "http://127.0.0.1:6874";
const devProxyWsTarget =
  process.env.VITE_DEV_PROXY_WS_TARGET ?? devProxyTarget.replace(/^http/, "ws");

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined;
          }
          if (
            id.includes("/@xyflow/") ||
            id.includes("/@dagrejs/") ||
            id.includes("/react-rnd/")
          ) {
            return "graph-vendor";
          }
          if (id.includes("/react-markdown/") || id.includes("/remark-gfm/")) {
            return "markdown-vendor";
          }
          if (
            id.includes("/motion/") ||
            id.includes("/lucide-react/") ||
            id.includes("/sonner/") ||
            id.includes("/@radix-ui/") ||
            id.includes("/react-resizable-panels/")
          ) {
            return "ui-vendor";
          }
          if (id.includes("/react/") || id.includes("/react-dom/")) {
            return "react-vendor";
          }
          return undefined;
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(rootDirectory, "src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 6873,
    strictPort: true,
    proxy: {
      "/api": {
        target: devProxyTarget,
        changeOrigin: true,
      },
      "/ws": {
        target: devProxyWsTarget,
        ws: true,
      },
    },
  },
});
