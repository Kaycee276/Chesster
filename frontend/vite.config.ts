import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

const plugins: any[] = [react(), tailwindcss()];

// https://vite.dev/config/
export default defineConfig({
	plugins: [
		react(),
		tailwindcss(),
		// Service worker + PWA support. The service worker precaches the built
		// app shell and static chessboard assets for offline play, and the
		// public/manifest.json enables "add to home screen" on mobile.
		VitePWA({
			registerType: "autoUpdate",
			injectRegister: "auto",
			// Use the hand-authored public/manifest.json instead of generating one.
			manifest: false,
			includeAssets: ["favicon.ico"],
			workbox: {
				// Precache the built app shell and static assets.
				globPatterns: ["**/*.{js,css,html,ico,png,svg,webp,woff,woff2}"],
				// Runtime-cache chessboard piece/image assets so the board renders
				// offline and on flaky connections.
				runtimeCaching: [
					{
						urlPattern: ({ request }) => request.destination === "image",
						handler: "CacheFirst",
						options: {
							cacheName: "chessboard-assets",
							expiration: {
								maxEntries: 100,
								maxAgeSeconds: 60 * 60 * 24 * 30,
							},
							cacheableResponse: { statuses: [0, 200] },
						},
					},
				],
			},
			devOptions: {
				enabled: false,
			},
		}),
	],
	plugins,
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
		setupFiles: "./src/test/setup.ts",
		environment: "node",
		setupFiles: ["./src/test/setup.ts"],
		exclude: ["**/node_modules/**", "**/e2e/**"],
		coverage: {
			provider: "v8",
			reporter: ["text", "json", "html", "lcov"],
			reportsDirectory: "./coverage",
		},
	},
});
