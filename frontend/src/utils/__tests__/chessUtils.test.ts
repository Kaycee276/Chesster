import { describe, expect, it } from "vitest";
import {
	buildFen,
	parseFen,
	validateFenPosition,
	calculateMaterial,
	INITIAL_BOARD,
} from "../chessUtils";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("buildFen", () => {
	it("writes every positional field", () => {
		expect(
			buildFen(INITIAL_BOARD, {
				turn: "black",
				castling: "Kq",
				enPassant: "e3",
				halfmoveClock: 7,
				fullmoveNumber: 12,
			}),
		).toBe("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b Kq e3 7 12");
	});

	it("falls back to neutral metadata when fields are omitted", () => {
		expect(buildFen(INITIAL_BOARD)).toBe(
			"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1",
		);
	});
});

describe("parseFen", () => {
	it("round-trips the starting position", () => {
		const parsed = parseFen(START_FEN);
		expect(parsed.board).toEqual(INITIAL_BOARD);
		expect(parsed.turn).toBe("white");
		expect(parsed.castling).toBe("KQkq");
		expect(parsed.enPassant).toBe("");
		expect(parsed.halfmoveClock).toBe(0);
		expect(parsed.fullmoveNumber).toBe(1);
	});

	it("parses a black-to-move position", () => {
		const parsed = parseFen("4k3/8/8/8/8/8/8/4K3 b - - 4 9");
		expect(parsed.turn).toBe("black");
		expect(parsed.board[0][4]).toBe("k");
		expect(parsed.board[7][4]).toBe("K");
	});
});

describe("validateFenPosition", () => {
	it("accepts the starting position", () => {
		expect(validateFenPosition(START_FEN)).toEqual({ valid: true });
	});

	it("rejects a board with no kings", () => {
		const result = validateFenPosition("8/8/8/8/8/8/8/8 w - - 0 1");
		expect(result.valid).toBe(false);
		expect(result.error).toMatch(/king/i);
	});

	it("rejects a board with two white kings", () => {
		const result = validateFenPosition("4k3/8/8/8/8/8/8/3KK3 w - - 0 1");
		expect(result.valid).toBe(false);
		expect(result.error).toMatch(/king/i);
	});

	it("rejects pawns on the first or eighth rank", () => {
		expect(
			validateFenPosition("4k1P1/8/8/8/8/8/8/4K3 w - - 0 1").error,
		).toMatch(/edge rows|rank 8/i);
		expect(
			validateFenPosition("4k3/8/8/8/8/8/8/3pK3 w - - 0 1").error,
		).toMatch(/edge rows|rank 1/i);
	});

	it("rejects a position where the side that just moved is in check", () => {
		const result = validateFenPosition("4k3/8/8/8/8/8/8/4R1K1 w - - 0 1");
		expect(result.valid).toBe(false);
		expect(result.error).toMatch(/cannot be in check/i);
	});

	it("rejects adjacent kings", () => {
		const result = validateFenPosition("8/8/8/8/8/8/8/4Kk2 w - - 0 1");
		expect(result.valid).toBe(false);
		expect(result.error).toMatch(/adjacent/i);
	});

	it("reports malformed FEN syntax", () => {
		const result = validateFenPosition("not-a-fen");
		expect(result.valid).toBe(false);
		expect(result.error).toBeTruthy();
	});
});

describe("calculateMaterial / getCapturedPiecesFromFen (Issue #792)", () => {
	it("returns zero captures and zero advantage for starting position", () => {
		const result = calculateMaterial(START_FEN);
		expect(result.whiteCaptured).toEqual({ p: 0, n: 0, b: 0, r: 0, q: 0 });
		expect(result.blackCaptured).toEqual({ p: 0, n: 0, b: 0, r: 0, q: 0 });
		expect(result.materialAdvantage).toBe(0);
	});

	it("accurately detects captured pieces and material advantage", () => {
		// Black is missing 1 pawn and 1 queen; White is missing 1 knight
		const fen = "rnb1kbnr/pppp1ppp/8/8/8/8/PPPPPPPP/R1BQKBNR w KQkq - 0 1";
		const result = calculateMaterial(fen);
		expect(result.whiteCaptured.p).toBe(1);
		expect(result.whiteCaptured.q).toBe(1);
		expect(result.blackCaptured.n).toBe(1);
		// White captured: 1 (p) + 9 (q) = 10. Black captured: 3 (n) = 3. Diff = 10 - 3 = +7
		expect(result.materialAdvantage).toBe(7);
	});
});
