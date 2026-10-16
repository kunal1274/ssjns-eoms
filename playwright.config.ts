import { defineConfig } from "@playwright/test";
import { loadEnvFile } from "node:process";
try {
  loadEnvFile(".env");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
const db = new URL(
  process.env.DATABASE_URL || "postgresql://invalid@127.0.0.1/eoms_test",
);
if (db.hostname !== "127.0.0.1")
  throw Error("Journey runner requires local synthetic PostgreSQL.");
db.pathname = "/eoms_test";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60000,
  expect: { timeout: 10000 },
  outputDir: ".local/e2e-results",
  reporter: [
    ["list"],
    ["html", { outputFolder: ".local/e2e-report", open: "never" }],
    ["junit", { outputFile: ".local/e2e-results/results.xml" }],
  ],
  metadata: {
    sourceCommit: process.env.GITHUB_SHA || "local-unversioned",
    environment: "local-eoms_test",
  },
  use: {
    baseURL: "http://localhost:5284",
    channel: "chrome",
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    // Authentication inputs can appear in traces: enable only after capture review.
    trace: "off",
    video: "off",
  },
  webServer: [
    {
      command: "node --import tsx apps/api/src/server.ts",
      url: "http://127.0.0.1:4210/api/health",
      reuseExistingServer: false,
      timeout: 30000,
      env: {
        DATABASE_URL: db.href,
        API_PORT: "4210",
        WEB_ORIGIN: "http://localhost:5284",
        NODE_ENV: "test",
      },
    },
    {
      command:
        "node node_modules/vite/bin/vite.js --config apps/web/vite.config.ts",
      url: "http://localhost:5284",
      reuseExistingServer: false,
      timeout: 30000,
      env: { WEB_PORT: "5284", API_TARGET: "http://127.0.0.1:4210" },
    },
  ],
  projects: [
    { name: "chrome-desktop" },
    { name: "chrome-mobile", use: { viewport: { width: 390, height: 844 } } },
  ],
});
