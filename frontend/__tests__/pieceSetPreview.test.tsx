// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import ThemeSelector from "../src/components/ThemeSelector";
import { PIECE_SETS, useThemeStore } from "../src/store/themeStore";

// React 19 wants this flag whenever act() is used outside its own test renderer.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ThemeSelector piece set previews", () => {
	let container: HTMLElement;
	let reactRoot: Root;

	beforeEach(() => {
		useThemeStore.setState({ boardTheme: "classic", pieceSet: "standard" });
		container = document.createElement("div");
		document.body.appendChild(container);
		reactRoot = createRoot(container);
		act(() => {
			reactRoot.render(createElement(ThemeSelector));
		});

		const trigger = container.querySelector('button[aria-label="Open board theme picker"]');
		act(() => {
			trigger!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
		});
	});

	afterEach(() => {
		act(() => {
			reactRoot.unmount();
		});
		container.remove();
	});

	it("renders a 2x2 preview for every piece set", () => {
		const previews = container.querySelectorAll('[data-testid="piece-set-preview"]');
		expect(previews).toHaveLength(PIECE_SETS.length);
		for (const preview of Array.from(previews)) {
			expect(preview.children).toHaveLength(4);
		}
	});

	it("previews King, Queen, Knight and Pawn in board order", () => {
		const standard = PIECE_SETS.find((set) => set.key === "standard")!;
		const firstPreview = container.querySelector('[data-testid="piece-set-preview"]')!;
		const glyphs = Array.from(firstPreview.children).map((cell) => cell.textContent);

		expect(glyphs).toEqual([
			standard.pieces.K,
			standard.pieces.Q,
			standard.pieces.N,
			standard.pieces.P,
		]);
	});
});
