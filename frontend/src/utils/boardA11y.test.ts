import { describe, it, expect } from "vitest";
import { squareAriaLabel, squareName } from "./boardA11y";

describe("squareName", () => {
	it("maps board corners to algebraic coordinates", () => {
		expect(squareName(0, 0)).toBe("a8"); // top-left
		expect(squareName(7, 7)).toBe("h1"); // bottom-right
		expect(squareName(7, 0)).toBe("a1");
		expect(squareName(0, 7)).toBe("h8");
	});

	it("maps a mid-board square", () => {
		// row 5 -> rank 3, col 5 -> file f
		expect(squareName(5, 5)).toBe("f3");
	});
});

describe("squareAriaLabel", () => {
	it("labels a white piece with colour, name, and square", () => {
		expect(squareAriaLabel("N", 5, 5)).toBe("white knight on f3");
		expect(squareAriaLabel("K", 7, 4)).toBe("white king on e1");
	});

	it("labels a black piece", () => {
		expect(squareAriaLabel("q", 0, 3)).toBe("black queen on d8");
		expect(squareAriaLabel("p", 1, 0)).toBe("black pawn on a7");
	});

	it("labels an empty square", () => {
		expect(squareAriaLabel(".", 4, 4)).toBe("e4, empty");
		expect(squareAriaLabel("", 4, 4)).toBe("e4, empty");
	});

	it("falls back to a generic name for an unknown piece letter", () => {
		expect(squareAriaLabel("x", 0, 0)).toBe("black piece on a8");
		expect(squareAriaLabel("X", 0, 0)).toBe("white piece on a8");
	});
});
