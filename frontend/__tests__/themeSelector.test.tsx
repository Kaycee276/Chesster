// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import ThemeSelector from "../src/components/ThemeSelector";
import { BOARD_THEMES, useThemeStore } from "../src/store/themeStore";

// React 19 wants this flag whenever act() is used outside its own test renderer.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function findButtonByText(root: HTMLElement, text: string): HTMLButtonElement | null {
	const buttons = Array.from(root.querySelectorAll("button"));
	return buttons.find((b) => b.textContent?.includes(text)) ?? null;
}

describe("ThemeSelector — High-Contrast theme (#314)", () => {
	let container: HTMLElement;
	let reactRoot: Root;

	beforeEach(() => {
		useThemeStore.setState({ boardTheme: "classic" });
		delete document.documentElement.dataset.theme;

		container = document.createElement("div");
		document.body.appendChild(container);
		reactRoot = createRoot(container);
		act(() => {
			reactRoot.render(createElement(ThemeSelector));
		});
	});

	afterEach(() => {
		act(() => {
			reactRoot.unmount();
		});
		container.remove();
		delete document.documentElement.dataset.theme;
	});

	const openPicker = () => {
		const trigger = container.querySelector('button[aria-label="Open board theme picker"]');
		expect(trigger).not.toBeNull();
		act(() => {
			trigger!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
		});
	};

	it("lists every board theme, including High Contrast", () => {
		openPicker();
		for (const theme of BOARD_THEMES) {
			expect(findButtonByText(container, theme.name), `${theme.name} missing`).not.toBeNull();
		}
	});

	it("applies the high-contrast theme on selection", () => {
		openPicker();

		const option = findButtonByText(container, "High Contrast");
		expect(option).not.toBeNull();
		expect(option!.getAttribute("aria-pressed")).toBe("false");

		act(() => {
			option!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
		});

		expect(useThemeStore.getState().boardTheme).toBe("high-contrast");
		// The data-theme attribute is what activates the high-contrast CSS
		// variables and crosshatch textures on every game screen.
		expect(document.documentElement.dataset.theme).toBe("high-contrast");

		// The picker closes on selection; reopening shows the theme as active.
		openPicker();
		const selected = findButtonByText(container, "High Contrast");
		expect(selected!.getAttribute("aria-pressed")).toBe("true");
	});

	it("previews the theme with maximum-contrast white/black swatches", () => {
		openPicker();
		const option = findButtonByText(container, "High Contrast");
		expect(option).not.toBeNull();
		const swatch = option!.querySelector("div[style]");
		// jsdom normalizes the hex colors to rgb() in the inline style.
		expect(swatch?.getAttribute("style")).toContain(
			"linear-gradient(135deg, rgb(255, 255, 255) 50%, rgb(0, 0, 0) 50%)",
		);
	});
});
