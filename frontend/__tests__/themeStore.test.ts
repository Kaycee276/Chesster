import { describe, it, expect, beforeEach, vi } from "vitest";
import {
	BOARD_THEMES,
	useThemeStore,
	applyColorMode,
	getResolvedColorMode,
} from "../src/store/themeStore";

describe("Theme Store & Dark/Light Mode", () => {
	let classListSet: Set<string>;

	beforeEach(() => {
		classListSet = new Set<string>();
		(globalThis as unknown as { document: unknown }).document = {
			documentElement: {
				classList: {
					add: (cls: string) => classListSet.add(cls),
					remove: (cls: string) => classListSet.delete(cls),
					contains: (cls: string) => classListSet.has(cls),
				},
				dataset: {} as Record<string, string>,
				style: {
					setProperty: vi.fn(),
				},
			},
		};
		useThemeStore.setState({ colorMode: "system" });
	});


	it("defaults to system colorMode", () => {
		expect(useThemeStore.getState().colorMode).toBe("system");
	});

	it("resolves dark and light modes directly", () => {
		expect(getResolvedColorMode("dark")).toBe("dark");
		expect(getResolvedColorMode("light")).toBe("light");
	});

	it("applies dark class when mode is dark", () => {
		applyColorMode("dark");
		expect(document.documentElement.classList.contains("dark")).toBe(true);
	});

	it("removes dark class when mode is light", () => {
		document.documentElement.classList.add("dark");
		applyColorMode("light");
		expect(document.documentElement.classList.contains("dark")).toBe(false);
	});

	it("updates store and applies mode on setColorMode", () => {
		const setColorMode = useThemeStore.getState().setColorMode;
		setColorMode("dark");
		expect(useThemeStore.getState().colorMode).toBe("dark");
		expect(document.documentElement.classList.contains("dark")).toBe(true);

		setColorMode("light");
		expect(useThemeStore.getState().colorMode).toBe("light");
		expect(document.documentElement.classList.contains("dark")).toBe(false);
	});

	it("includes the High-Contrast accessibility theme (#314)", () => {
		const theme = BOARD_THEMES.find((t) => t.key === "high-contrast");
		expect(theme).toBeDefined();
		expect(theme?.name).toBe("High Contrast");
		// Pure white vs pure black squares: the maximum 21:1 contrast ratio.
		expect(theme?.light.toLowerCase()).toBe("#ffffff");
		expect(theme?.dark.toLowerCase()).toBe("#000000");
	});

	it("applies the High-Contrast theme via setBoardTheme", () => {
		const setProperty = document.documentElement.style.setProperty as ReturnType<typeof vi.fn>;
		const setBoardTheme = useThemeStore.getState().setBoardTheme;

		setBoardTheme("high-contrast");

		expect(useThemeStore.getState().boardTheme).toBe("high-contrast");
		expect(document.documentElement.dataset.theme).toBe("high-contrast");
		// Runtime square variables are overridden with the theme colors.
		expect(setProperty).toHaveBeenCalledWith("--sq-light", "#ffffff");
		expect(setProperty).toHaveBeenCalledWith("--sq-dark", "#000000");
	});
});
