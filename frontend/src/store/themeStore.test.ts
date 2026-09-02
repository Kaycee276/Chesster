import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { useThemeStore, applyColorMode, applyBoardTheme } from "../store/themeStore";

function setupStorage() {
	const store: Record<string, string> = {};
	Object.defineProperty(window, "localStorage", {
		value: {
			getItem: (key: string) => store[key] ?? null,
			setItem: (key: string, value: string) => { store[key] = value; },
			removeItem: (key: string) => { delete store[key]; },
		},
		writable: true,
	});
}

describe("themeStore color mode", () => {
	beforeEach(() => {
		setupStorage();
		useThemeStore.setState({
			boardTheme: "classic",
			pieceSet: "standard",
			colorMode: "system",
		});
		document.documentElement.classList.remove("dark");
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("applies dark class when mode is dark", () => {
		applyColorMode("dark");
		expect(document.documentElement.classList.contains("dark")).toBe(true);
	});

	it("removes dark class when mode is light", () => {
		applyColorMode("dark");
		applyColorMode("light");
		expect(document.documentElement.classList.contains("dark")).toBe(false);
	});

	it("respects system preference for system mode", () => {
		window.matchMedia = vi.fn().mockImplementation((query: string) => ({
			matches: query === "(prefers-color-scheme: dark)",
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		})) as unknown as typeof window.matchMedia;

		applyColorMode("system");
		expect(document.documentElement.classList.contains("dark")).toBe(true);
	});

	it("updates color mode via store action", () => {
		useThemeStore.getState().setColorMode("dark");
		expect(useThemeStore.getState().colorMode).toBe("dark");
		expect(document.documentElement.classList.contains("dark")).toBe(true);
	});
});

describe("themeStore board theme", () => {
	it("applies board theme css variables", () => {
		applyBoardTheme("neon");
		expect(document.documentElement.style.getPropertyValue("--sq-light")).toBe("#15c2b8");
		expect(document.documentElement.style.getPropertyValue("--sq-dark")).toBe("#0b1020");
	});
});
