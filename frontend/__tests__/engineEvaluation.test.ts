import { describe, it, expect } from "vitest";
import {
	MATE_SCORE_CP,
	evaluationToWhitePercent,
	fenSideToMove,
	formatEvaluation,
	inferCastlingRights,
	parseUciInfo,
	toEngineFen,
	toWhitePerspective,
} from "../src/utils/engineEvaluation";
import { INITIAL_BOARD } from "../src/utils/chessUtils";

const cloneBoard = (board: string[][]) => board.map((row) => [...row]);

describe("parseUciInfo", () => {
	it("parses a centipawn info line", () => {
		const info = parseUciInfo(
			"info depth 12 seldepth 17 multipv 1 score cp 34 nodes 12345 nps 500000 time 25 pv e2e4 e7e5 g1f3",
		);
		expect(info).toEqual({
			depth: 12,
			multipv: 1,
			score: { type: "cp", value: 34 },
			bound: null,
			pv: ["e2e4", "e7e5", "g1f3"],
		});
	});

	it("parses mate scores and bounds", () => {
		expect(parseUciInfo("info depth 20 score mate -3 pv h7h8")?.score).toEqual({ type: "mate", value: -3 });
		expect(parseUciInfo("info depth 9 score cp 50 lowerbound nodes 10")?.bound).toBe("lowerbound");
		expect(parseUciInfo("info depth 9 score cp 50 upperbound")?.bound).toBe("upperbound");
	});

	it("returns null for lines without a score", () => {
		expect(parseUciInfo("info depth 5 currmove e2e4 currmovenumber 1")).toBeNull();
		expect(parseUciInfo("info string NNUE evaluation using nn.bin")).toBeNull();
		expect(parseUciInfo("bestmove e2e4")).toBeNull();
	});
});

describe("toWhitePerspective", () => {
	it("keeps White-to-move scores unchanged", () => {
		expect(toWhitePerspective({ type: "cp", value: 120 }, "w")).toEqual({ scoreCp: 120, mate: null });
	});

	it("negates Black-to-move scores", () => {
		expect(toWhitePerspective({ type: "cp", value: 120 }, "b")).toEqual({ scoreCp: -120, mate: null });
		expect(toWhitePerspective({ type: "cp", value: 0 }, "b").scoreCp).toBe(0);
		expect(Object.is(toWhitePerspective({ type: "cp", value: 0 }, "b").scoreCp, -0)).toBe(false);
	});

	it("converts mate distances to White's perspective", () => {
		expect(toWhitePerspective({ type: "mate", value: 4 }, "w")).toEqual({ scoreCp: MATE_SCORE_CP, mate: 4 });
		expect(toWhitePerspective({ type: "mate", value: 4 }, "b")).toEqual({ scoreCp: -MATE_SCORE_CP, mate: -4 });
		expect(toWhitePerspective({ type: "mate", value: -2 }, "b")).toEqual({ scoreCp: MATE_SCORE_CP, mate: 2 });
	});

	it("treats mate 0 as a win for the side that is not to move", () => {
		expect(toWhitePerspective({ type: "mate", value: 0 }, "w")).toEqual({ scoreCp: -MATE_SCORE_CP, mate: 0 });
		expect(toWhitePerspective({ type: "mate", value: 0 }, "b")).toEqual({ scoreCp: MATE_SCORE_CP, mate: 0 });
	});
});

describe("fenSideToMove", () => {
	it("reads the active colour", () => {
		expect(fenSideToMove("8/8/8/8/8/8/8/K6k w - - 0 1")).toBe("w");
		expect(fenSideToMove("8/8/8/8/8/8/8/K6k b - - 0 1")).toBe("b");
	});
});

describe("evaluationToWhitePercent", () => {
	it("is 50% for a level position", () => {
		expect(evaluationToWhitePercent(0)).toBe(50);
	});

	it("follows the sigmoid 50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1)", () => {
		const expected = (cp: number) => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
		for (const cp of [-1000, -300, -50, 50, 150, 300, 1000]) {
			expect(evaluationToWhitePercent(cp)).toBeCloseTo(expected(cp), 10);
		}
	});

	it("is symmetric and monotonic", () => {
		expect(evaluationToWhitePercent(250) + evaluationToWhitePercent(-250)).toBeCloseTo(100, 10);
		expect(evaluationToWhitePercent(100)).toBeLessThan(evaluationToWhitePercent(200));
	});

	it("stays within 0-100 for huge scores", () => {
		expect(evaluationToWhitePercent(1e9)).toBeLessThanOrEqual(100);
		expect(evaluationToWhitePercent(-1e9)).toBeGreaterThanOrEqual(0);
	});

	it("fills the bar completely for forced mates", () => {
		expect(evaluationToWhitePercent(MATE_SCORE_CP, 3)).toBe(100);
		expect(evaluationToWhitePercent(-MATE_SCORE_CP, -3)).toBe(0);
		expect(evaluationToWhitePercent(-MATE_SCORE_CP, 0)).toBe(0);
	});
});

describe("formatEvaluation", () => {
	it("formats centipawns as pawns with a sign", () => {
		expect(formatEvaluation(150)).toBe("+1.5");
		expect(formatEvaluation(-320)).toBe("-3.2");
		expect(formatEvaluation(0)).toBe("0.0");
		expect(formatEvaluation(-4)).toBe("0.0");
	});

	it("formats mates", () => {
		expect(formatEvaluation(MATE_SCORE_CP, 4)).toBe("M4");
		expect(formatEvaluation(-MATE_SCORE_CP, -4)).toBe("-M4");
		expect(formatEvaluation(MATE_SCORE_CP, 0)).toBe("1-0");
		expect(formatEvaluation(-MATE_SCORE_CP, 0)).toBe("0-1");
	});
});

describe("inferCastlingRights", () => {
	it("grants all rights in the starting position", () => {
		expect(inferCastlingRights(INITIAL_BOARD)).toBe("KQkq");
	});

	it("drops rights when the king or a rook has left its square", () => {
		const board = cloneBoard(INITIAL_BOARD);
		board[7][7] = "."; // White h1 rook gone
		board[0][4] = "."; // Black king moved
		board[1][4] = "k";
		expect(inferCastlingRights(board)).toBe("Q");
	});

	it("returns '-' when no rights remain", () => {
		const board = cloneBoard(INITIAL_BOARD);
		board[7][4] = ".";
		board[0][4] = ".";
		expect(inferCastlingRights(board)).toBe("-");
	});
});

describe("toEngineFen", () => {
	it("builds a full FEN for the starting position", () => {
		expect(toEngineFen(INITIAL_BOARD, "white")).toBe(
			"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
		);
	});

	it("encodes the side to move", () => {
		expect(toEngineFen(INITIAL_BOARD, "black")?.split(" ")[1]).toBe("b");
	});

	it("rejects positions that could crash the engine", () => {
		const noKing = cloneBoard(INITIAL_BOARD);
		noKing[7][4] = ".";
		expect(toEngineFen(noKing, "white")).toBeNull();

		const twoKings = cloneBoard(INITIAL_BOARD);
		twoKings[4][4] = "K";
		expect(toEngineFen(twoKings, "white")).toBeNull();

		const backRankPawn = cloneBoard(INITIAL_BOARD);
		backRankPawn[0][0] = "P";
		expect(toEngineFen(backRankPawn, "white")).toBeNull();

		const unknownPiece = cloneBoard(INITIAL_BOARD);
		unknownPiece[4][4] = "x";
		expect(toEngineFen(unknownPiece, "white")).toBeNull();

		expect(toEngineFen(INITIAL_BOARD.slice(0, 7), "white")).toBeNull();
	});
});
