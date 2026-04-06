import path from "node:path";
import os from "node:os";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** Außerhalb von Dropbox – vermeidet EBUSY/Locks bei node_modules/.vite */
const cacheDir = path.join(os.tmpdir(), "vite-musiclist-dsm-cache");

export default defineConfig({
  plugins: [react()],
  cacheDir,
  server: {
    port: 5273,
    strictPort: true,
    host: true,
    /** Verhindert, dass der Browser im Dev-Modus alte Bundles aus dem Cache lädt. */
    headers: {
      "Cache-Control": "no-store",
    },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:5274",
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 5273,
    strictPort: true,
    host: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:5274",
        changeOrigin: true,
      },
    },
  },
});