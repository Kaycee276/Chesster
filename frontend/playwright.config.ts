import { defineConfig, devices } from "@playwright/test";

const MOCK_BACKEND_PORT = process.env.MOCK_BACKEND_PORT || "4310";
const FRONTEND_PORT = 3090;
const BACKEND_URL = `http://localhost:${MOCK_BACKEND_PORT}/`;

export default defineConfig({
	testDir: "./e2e",
	timeout: 60_000,
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	workers: 1,
	reporter: "list",
	use: {
		baseURL: `http://localhost:${FRONTEND_PORT}`,
		trace: "on-first-retry",
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
	webServer: [
		{
			command: "node e2e/mock-backend/server.cjs",
			port: Number(MOCK_BACKEND_PORT),
			reuseExistingServer: !process.env.CI,
			env: { MOCK_BACKEND_PORT },
		},
		{
			command: "npm run dev",
			port: FRONTEND_PORT,
			reuseExistingServer: !process.env.CI,
			env: {
				VITE_E2E: "true",
				VITE_BACKEND_URL: BACKEND_URL,
			},
		},
	],
});
