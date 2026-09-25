import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { visualizer } from "rollup-plugin-visualizer";

const analyzeBundle = process.env.ANALYZE === "true";

// https://vite.dev/config/
export default defineConfig({
	plugins: [
		react(),
		tailwindcss(),
		...(analyzeBundle
			? [
					visualizer({
						filename: "stats.html",
						template: "treemap",
						open: false,
						gzipSize: true,
						brotliSize: true,
					})
				]
			: []),
	],
	build: {
		chunkSizeWarningLimit: 500,
		rollupOptions: {
			output: {
				manualChunks: {
					vendor: ["react", "react-dom", "react-router-dom"],
					stellar: ["@stellar/stellar-sdk", "@stellar/freighter-api"],
				},
			},
		},
	},
	server: {
		port: 3090,
		// host: true,
	},
	test: {
		globals: true,
		environment: "jsdom",
		exclude: ["**/node_modules/**", "**/e2e/**"],
		coverage: {
			provider: "v8",
			reporter: ["text", "json", "html", "lcov"],
			reportsDirectory: "./coverage",
		},
	},
});
