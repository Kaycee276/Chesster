import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
		baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3090",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
		command: "npm run dev -- --host 127.0.0.1 --port 3090 --strictPort",
		url: "http://127.0.0.1:3090",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
