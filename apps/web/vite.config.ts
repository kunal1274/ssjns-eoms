import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  root: "apps/web",
  plugins: [react()],
  server: {
    host: process.env.WEB_HOST || "127.0.0.1",
    port: Number(process.env.WEB_PORT || 5174),
    strictPort: true,
    proxy: { "/api": process.env.API_TARGET || "http://127.0.0.1:4100" },
  },
  preview: {
    host: "127.0.0.1",
    port: Number(process.env.PWA_PORT || 5175),
    strictPort: true,
    proxy: { "/api": process.env.API_TARGET || "http://127.0.0.1:4101" },
  },
  build: { outDir: "dist" },
});
