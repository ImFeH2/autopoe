import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const rootDirectory = fileURLToPath(new URL(".", import.meta.url));
const serverHost = process.env.FLOWENT_FRONTEND_HOST || "127.0.0.1";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(rootDirectory, "src"),
    },
  },
  server: {
    host: serverHost,
    allowedHosts: true,
    port: 6873,
    proxy: {
      "/api": {
        target: "http://localhost:6874",
      },
    },
    strictPort: true,
  },
});
