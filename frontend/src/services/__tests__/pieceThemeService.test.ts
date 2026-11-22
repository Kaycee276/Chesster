import { describe, expect, it } from "vitest";
import { PIECE_SETS } from "../../store/themeStore";
import {
	getPieceGlyph,
	getPieceSet,
	getPreviewBoard,
	PREVIEW_PIECE_CODES,
} from "../pieceThemeService";

describe("pieceThemeService", () => {
	it("resolves a known piece set by key", () => {
		const wood = PIECE_SETS.find((set) => set.key === "wood");
		expect(wood).toBeDefined();
		expect(getPieceSet("wood")).toBe(wood);
	});

	it("falls back to the standard set for unknown or stale keys", () => {
		const standard = PIECE_SETS.find((set) => set.key === "standard");
		expect(getPieceSet("no-such-set")).toBe(standard);
		expect(getPieceSet("")).toBe(standard);
	});

	it("returns the glyph for a piece code and an empty string for unknown codes", () => {
		const standard = PIECE_SETS.find((set) => set.key === "standard")!;
		expect(getPieceGlyph("standard", "K")).toBe(standard.pieces.K);
		expect(getPieceGlyph("standard", "X")).toBe("");
	});

	it("builds a 2x2 preview of King, Queen, Knight and Pawn", () => {
		const standard = PIECE_SETS.find((set) => set.key === "standard")!;
		const board = getPreviewBoard("standard");

		expect(PREVIEW_PIECE_CODES).toEqual([
			["K", "Q"],
			["N", "P"],
		]);
		expect(board).toEqual([
			[standard.pieces.K, standard.pieces.Q],
			[standard.pieces.N, standard.pieces.P],
		]);
	});

	it("memoizes the preview per set and returns distinct previews for different sets", () => {
		const first = getPreviewBoard("neo");
		expect(getPreviewBoard("neo")).toBe(first);

		const other = getPreviewBoard("pixel");
		expect(other).not.toBe(first);
	});
});
