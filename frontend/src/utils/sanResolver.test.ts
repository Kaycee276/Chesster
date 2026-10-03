import { describe, it, expect } from "vitest";
import { INITIAL_BOARD } from "./chessUtils";
import { resolveSan } from "./sanResolver";

/** Board after 1. e4 with everything else at the start position. */
function boardAfterE4(): string[][] {
	const board = INITIAL_BOARD.map((row) => [...row]);
	board[6][4] = "."; // e2 pawn
	board[4][4] = "P"; // e4
	return board;
}

describe("resolveSan", () => {
	it("resolves a pawn push", () => {
		expect(resolveSan(INITIAL_BOARD, "e4", "white")).toEqual({
			from: [6, 4],
			to: [4, 4],
		});
	});

	it("resolves a knight move", () => {
		expect(resolveSan(INITIAL_BOARD, "Nf3", "white")).toEqual({
			from: [7, 6],
			to: [5, 5],
		});
	});

	it("rejects a move that is not legal for the side to move", () => {
		expect(resolveSan(INITIAL_BOARD, "e5", "white")).toBeNull();
		expect(resolveSan(INITIAL_BOARD, "e4", "black")).toBeNull();
	});

	it("rejects malformed tokens", () => {
		expect(resolveSan(INITIAL_BOARD, "hello", "white")).toBeNull();
		expect(resolveSan(INITIAL_BOARD, "", "white")).toBeNull();
	});

	it("resolves a capture with the origin file", () => {
		// White pawn e4, black pawn d5 → exd5 must originate on the e-file.
		const board = boardAfterE4();
		board[3][3] = "p"; // d5
		const result = resolveSan(board, "exd5", "white");
		expect(result).toEqual({ from: [4, 4], to: [3, 3] });
	});

	it("resolves castling on the kingside", () => {
		const board = INITIAL_BOARD.map((row) => [...row]);
		// Clear the f1/g1 squares so the castle geometry is legal.
		board[7][5] = ".";
		board[7][6] = ".";
		expect(resolveSan(board, "O-O", "white")).toEqual({
			from: [7, 4],
			to: [7, 6],
		});
	});

	it("resolves castling on the queenside", () => {
		const board = INITIAL_BOARD.map((row) => [...row]);
		board[7][1] = ".";
		board[7][2] = ".";
		board[7][3] = ".";
		expect(resolveSan(board, "O-O-O", "white")).toEqual({
			from: [7, 4],
			to: [7, 2],
		});
	});

	it("rejects castling through an occupied square", () => {
		// Start position: f1 bishop blocks O-O.
		expect(resolveSan(INITIAL_BOARD, "O-O", "white")).toBeNull();
	});

	it("carries the promotion piece", () => {
		const board = INITIAL_BOARD.map((row) => [...row]);
		// White pawn on e7, clear e8; promotion push e8=Q must be the only
		// candidate and carry the promotion piece.
		board[6][4] = "."; // e2 pawn removed
		board[1][4] = "P"; // white pawn placed on e7
		board[0][4] = "."; // e8 cleared
		const result = resolveSan(board, "e8=Q", "white");
		expect(result).toEqual({ from: [1, 4], to: [0, 4], promotion: "q" });
	});

	it("resolves a black move for the black side", () => {
		const board = INITIAL_BOARD.map((row) => [...row]);
		board[6][4] = "."; // white e-pawn gone
		board[4][4] = "P"; // e4 played
		expect(resolveSan(board, "c5", "black")).toEqual({
			from: [1, 2],
			to: [3, 2],
		});
	});

	it("uses disambiguation when two pieces reach the same square", () => {
		const board = INITIAL_BOARD.map((row) => [...row]);
		// Rooks on a1 and h1 with a clear back rank: both reach d1 after the
		// queen vacates and d-file opens. Rad1 pins the a-file rook.
		board[7][1] = "."; // b1 knight away
		board[7][2] = "."; // c1 bishop away
		board[7][3] = "."; // d1 queen away
		const result = resolveSan(board, "Rad1", "white");
		expect(result).toEqual({ from: [7, 0], to: [7, 3] });
	});
});
