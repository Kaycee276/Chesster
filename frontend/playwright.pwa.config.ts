import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "offlinePlay.spec.ts",
  timeout: 90_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3090",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium-pwa", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm run build && pnpm exec vite preview --host 127.0.0.1 --port 3090 --strictPort",
    url: "http://127.0.0.1:3090",
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
