const store: Record<string, string> = {};
Object.defineProperty(window, "localStorage", {
	value: {
		getItem: (key: string) => store[key] ?? null,
		setItem: (key: string, value: string) => { store[key] = value; },
		removeItem: (key: string) => { delete store[key]; },
		clear: () => { for (const key in store) delete store[key]; },
	},
	writable: true,
});
