// Shared vitest setup: DOM matchers for component tests (#315/#317/#318).
import "@testing-library/jest-dom/vitest";

if (!import.meta.env.VITE_ESCROW_CONTRACT_ADDRESS) {
	import.meta.env.VITE_ESCROW_CONTRACT_ADDRESS = "CA4OPJENMO3ZL2AEJ4IZD4ZQI3TRWK5ES6NTWZUGRUWSTSVYT5H46I4Y";
}
if (!import.meta.env.VITE_CONTRACT_ID) {
	import.meta.env.VITE_CONTRACT_ID = "CA4OPJENMO3ZL2AEJ4IZD4ZQI3TRWK5ES6NTWZUGRUWSTSVYT5H46I4Y";
}
/**
 * Vitest global setup.
 *
 * The suite runs in the default `node` environment, so browser globals that
 * some modules touch at import time are polyfilled here. `soundService`, for
 * example, reads persisted mute/volume state from `localStorage` when its
 * singleton is constructed.
 */

if (typeof globalThis.localStorage === "undefined") {
	const store = new Map<string, string>();
	globalThis.localStorage = {
		getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
		setItem: (key: string, value: string) => {
			store.set(key, String(value));
		},
		removeItem: (key: string) => {
			store.delete(key);
		},
		clear: () => {
			store.clear();
		},
		key: (index: number) => Array.from(store.keys())[index] ?? null,
		get length() {
			return store.size;
		},
	} as Storage;
}

if (typeof globalThis.ResizeObserver === "undefined") {
	globalThis.ResizeObserver = class ResizeObserver {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
}
