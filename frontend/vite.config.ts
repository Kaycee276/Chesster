import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
	plugins: [react(), tailwindcss()],
	resolve: {
		alias:
			// Playwright E2E runs have no real Freighter browser extension to talk
			// to. Swap the wallet SDK for a deterministic stub (only when
			// VITE_E2E=true is set by playwright.config.ts) so e2e specs can drive
			// wallet "connection" without touching any application source.
			process.env.VITE_E2E === "true"
				? {
						"@stellar/freighter-api": path.resolve(
							__dirname,
							"e2e/stubs/freighterApiStub.ts",
						),
					}
				: {},
	},
	server: {
		port: 3090,
		// host: true,
	},
	test: {
		globals: true,
		environment: "node",
		exclude: ["**/node_modules/**", "e2e/**"],
		coverage: {
			provider: "v8",
			reporter: ["text", "json", "html", "lcov"],
			reportsDirectory: "./coverage",
		},
	},
});
