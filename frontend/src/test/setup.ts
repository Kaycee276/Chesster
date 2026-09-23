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
