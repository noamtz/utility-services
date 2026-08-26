import { defineConfig, devices } from "@playwright/test";

import { releaseBaseUrl } from "./tests/e2e/support/release-config.js";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 12 * 60 * 1_000,
  globalTimeout: 15 * 60 * 1_000,
  expect: { timeout: 15_000 },
  outputDir: "test-results",
  reporter: "line",
  projects: [
    {
      name: "authorized-deployed",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: releaseBaseUrl(process.env),
        headless: true,
        trace: "off",
        screenshot: "off",
        video: "off",
      },
    },
  ],
});
