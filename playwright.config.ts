import "./e2e/env";
import { defineConfig } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? process.env.FRONTEND_ORIGIN ?? "http://localhost:3000";
const origin = new URL(baseURL);

export default defineConfig({
  testDir: "./e2e",
  // Run artifacts live under the disposable artifacts/ tree (see
  // docs/engineering/artifacts.md), so a run never leaves screenshots, traces
  // or reports scattered across the repo root.
  outputDir: "artifacts/e2e",
  reporter: [["list"], ["html", { outputFolder: "artifacts/e2e/report", open: "never" }]],
  // The performance scenario has its own config: one worker, no retries, and a
  // running production build. It must not be swept up by the ordinary suite.
  testIgnore: "**/perf/**",
  timeout: 60000,
  workers: 1,
  retries: 0,
  use: {
    baseURL,
    headless: true,
    storageState: {
      cookies: [{
        name: "multica-locale",
        value: "en",
        domain: origin.hostname,
        path: "/",
        expires: -1,
        httpOnly: false,
        secure: origin.protocol === "https:",
        sameSite: "Lax",
      }],
      origins: [],
    },
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
  // Don't auto-start servers — they must be running already
  // This avoids complexity and port conflicts during testing
});
