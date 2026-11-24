import { describe, it, expect } from "vitest";
import { FIGURINES, formatMove, toFigurineNotation } from "../../src/utils/figurineNotation";

describe("toFigurineNotation", () => {
	it("replaces the leading piece letter with the white glyph", () => {
		expect(toFigurineNotation("Nf3", "w")).toBe("♘f3");
		expect(toFigurineNotation("Qh5#", "w")).toBe("♕h5#");
		expect(toFigurineNotation("Ke1", "w")).toBe("♔e1");
		expect(toFigurineNotation("Rd1", "w")).toBe("♖d1");
		expect(toFigurineNotation("Bc4", "w")).toBe("♗c4");
	});

	it("uses the black glyphs for black moves", () => {
		expect(toFigurineNotation("Nc6", "b")).toBe("♞c6");
		expect(toFigurineNotation("Qxd4+", "b")).toBe("♛xd4+");
		expect(toFigurineNotation("Kg8", "b")).toBe("♚g8");
		expect(toFigurineNotation("Rfd8", "b")).toBe("♜fd8");
		expect(toFigurineNotation("Bb4", "b")).toBe("♝b4");
	});

	it("leaves pawn moves unchanged, including captures and promotions", () => {
		expect(toFigurineNotation("e4", "w")).toBe("e4");
		expect(toFigurineNotation("exd5", "b")).toBe("exd5");
		expect(toFigurineNotation("b8=Q", "w")).toBe("b8=Q");
	});

	it("leaves castling unchanged", () => {
		expect(toFigurineNotation("O-O", "w")).toBe("O-O");
		expect(toFigurineNotation("O-O-O", "b")).toBe("O-O-O");
	});

	it("leaves an empty string unchanged", () => {
		expect(toFigurineNotation("", "w")).toBe("");
	});

	it("maps every upper-case piece letter in both colours", () => {
		for (const letter of ["K", "Q", "R", "B", "N"]) {
			expect(toFigurineNotation(`${letter}a1`, "w")).toBe(`${FIGURINES.w[letter]}a1`);
			expect(toFigurineNotation(`${letter}a1`, "b")).toBe(`${FIGURINES.b[letter]}a1`);
		}
	});
});

describe("formatMove", () => {
	it("returns the SAN unchanged when figurines are off", () => {
		expect(formatMove("Nf3", "w", false)).toBe("Nf3");
	});

	it("returns the figurine form when figurines are on", () => {
		expect(formatMove("Nf3", "w", true)).toBe("♘f3");
	});
});
