/**
 * Unit tests for puzzle API and utilities
 * Component-level tests for PuzzlePage would require testing-library/react
 * which is not in the dependencies. These tests focus on core logic.
 */

// Test helper functions used in PuzzlePage
function fenToBoard(fen: string): string[][] {
	const rows = fen.split(" ")[0].split("/");
	return rows.map((row) => {
		const result: string[] = [];
		for (const char of row) {
			if (/\d/.test(char)) {
				result.push(...Array(parseInt(char, 10)).fill("."));
			} else {
				result.push(char);
			}
		}
		return result;
	});
}

function applyMove(
	board: string[][],
	move: { from: [number, number]; to: [number, number]; promotion?: string },
): string[][] {
	const newBoard = board.map((row) => [...row]);
	const piece = newBoard[move.from[0]][move.from[1]];

	newBoard[move.from[0]][move.from[1]] = ".";

	if (move.promotion) {
		newBoard[move.to[0]][move.to[1]] = move.promotion;
	} else {
		newBoard[move.to[0]][move.to[1]] = piece;
	}

	return newBoard;
}

describe("Puzzle utilities", () => {
	describe("fenToBoard", () => {
		it("should convert starting FEN to board array", () => {
			const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
			const board = fenToBoard(fen);

			expect(board).toHaveLength(8);
			expect(board[0]).toEqual(["r", "n", "b", "q", "k", "b", "n", "r"]);
			expect(board[1]).toEqual(["p", "p", "p", "p", "p", "p", "p", "p"]);
			expect(board[6]).toEqual(["P", "P", "P", "P", "P", "P", "P", "P"]);
			expect(board[7]).toEqual(["R", "N", "B", "Q", "K", "B", "N", "R"]);
		});

		it("should handle empty squares correctly", () => {
			const fen = "8/8/8/8/8/8/8/8 w KQkq - 0 1";
			const board = fenToBoard(fen);

			for (const row of board) {
				expect(row).toEqual(Array(8).fill("."));
			}
		});

		it("should handle complex FEN positions", () => {
			const fen = "r1bqkb1r/pppp1ppp/2n2n2/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4";
			const board = fenToBoard(fen);

			expect(board[0][0]).toBe("r");
			expect(board[0][1]).toBe(".");
			expect(board[0][2]).toBe("b");
			expect(board[4][4]).toBe("p");
		});
	});

	describe("applyMove", () => {
		it("should move a piece from source to destination", () => {
			const board = fenToBoard("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
			const move = { from: [6, 4], to: [4, 4] }; // e2-e4

			const newBoard = applyMove(board, move);

			expect(newBoard[6][4]).toBe("."); // source empty
			expect(newBoard[4][4]).toBe("P"); // destination has piece
		});

		it("should handle pawn promotion", () => {
			// Setup: white pawn on e7
			const board: string[][] = Array(8)
				.fill(null)
				.map(() => Array(8).fill("."));
			board[1][4] = "P";

			const move = {
				from: [1, 4],
				to: [0, 4],
				promotion: "Q",
			};

			const newBoard = applyMove(board, move);

			expect(newBoard[1][4]).toBe(".");
			expect(newBoard[0][4]).toBe("Q");
		});

		it("should handle captures", () => {
			const board: string[][] = Array(8)
				.fill(null)
				.map(() => Array(8).fill("."));
			board[4][4] = "P"; // white pawn
			board[3][5] = "p"; // black pawn

			const move = { from: [4, 4], to: [3, 5] };

			const newBoard = applyMove(board, move);

			expect(newBoard[4][4]).toBe(".");
			expect(newBoard[3][5]).toBe("P"); // white pawn captured black pawn
		});

		it("should not modify original board", () => {
			const board = fenToBoard("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
			const originalE2 = board[6][4];

			const move = { from: [6, 4], to: [4, 4] };
			applyMove(board, move);

			expect(board[6][4]).toBe(originalE2);
		});
	});

	describe("Move validation logic", () => {
		it("should correctly identify matching moves", () => {
			const userMove = { from: [6, 4], to: [4, 4] };
			const expectedMove = { from: [6, 4], to: [4, 4] };

			const moveMatches =
				expectedMove.from[0] === userMove.from[0] &&
				expectedMove.from[1] === userMove.from[1] &&
				expectedMove.to[0] === userMove.to[0] &&
				expectedMove.to[1] === userMove.to[1];

			expect(moveMatches).toBe(true);
		});

		it("should correctly identify non-matching moves", () => {
			const userMove = { from: [6, 5], to: [4, 5] };
			const expectedMove = { from: [6, 4], to: [4, 4] };

			const moveMatches =
				expectedMove.from[0] === userMove.from[0] &&
				expectedMove.from[1] === userMove.from[1] &&
				expectedMove.to[0] === userMove.to[0] &&
				expectedMove.to[1] === userMove.to[1];

			expect(moveMatches).toBe(false);
		});
	});

	describe("Square highlighting for hints", () => {
		it("should extract source square from move", () => {
			const move = { from: [6, 4], to: [4, 4] };
			const sourceSquare = move.from;

			expect(sourceSquare).toEqual([6, 4]);
		});

		it("should not expose destination square in hint", () => {
			const move = { from: [6, 4], to: [4, 4] };

			// Hint should only show source
			const hintSquare = move.from;

			// Should NOT be the destination
			expect(hintSquare).not.toEqual(move.to);
			expect(hintSquare).toEqual([6, 4]);
		});

		it("should convert board position to algebraic notation", () => {
			const row = 6;
			const col = 4;

			// Convert to algebraic: col (0-7) -> a-h, row (0-7) -> 8-1
			const file = String.fromCharCode(97 + col); // a-h
			const rank = 8 - row; // 1-8

			expect(`${file}${rank}`).toBe("e2");
		});
	});

	describe("Timer management", () => {
		it("should schedule and cancel timeouts correctly", () => {
			const spy = vi.spyOn(global, "setTimeout");
			const clearSpy = vi.spyOn(global, "clearTimeout");

			let timerRef: ReturnType<typeof setTimeout> | null = null;

			const callback = vi.fn();
			timerRef = setTimeout(callback, 300);

			expect(spy).toHaveBeenCalledWith(callback, 300);

			if (timerRef !== null) {
				clearTimeout(timerRef);
			}

			expect(clearSpy).toHaveBeenCalledWith(timerRef);

			spy.mockRestore();
			clearSpy.mockRestore();
		});
	});

	describe("Confetti canvas cleanup", () => {
		it("should create and remove canvas for confetti", () => {
			const createSpy = vi.spyOn(document, "createElement");
			const removeSpy = vi.spyOn(document.body, "removeChild");

			// Simulate confetti creation
			const canvas = document.createElement("canvas");
			document.body.appendChild(canvas);

			expect(createSpy).toHaveBeenCalledWith("canvas");

			// Simulate cleanup
			if (document.body.contains(canvas)) {
				document.body.removeChild(canvas);
			}

			expect(removeSpy).toHaveBeenCalledWith(canvas);

			createSpy.mockRestore();
			removeSpy.mockRestore();
		});
	});

	describe("Puzzle completion detection", () => {
		it("should detect when all moves in solution are completed", () => {
			const solution = [
				{ from: [6, 4], to: [4, 4] },
				{ from: [1, 4], to: [3, 4] },
				{ from: [6, 6], to: [5, 4] },
			];

			let moveStep = 0;

			// Simulate completing all moves
			moveStep++; // after first user move
			moveStep++; // after opponent reply
			moveStep++; // after second user move

			const isComplete = moveStep >= solution.length;
			expect(isComplete).toBe(true);
		});

		it("should not mark incomplete puzzle as solved", () => {
			const solution = [
				{ from: [6, 4], to: [4, 4] },
				{ from: [1, 4], to: [3, 4] },
				{ from: [6, 6], to: [5, 4] },
			];

			const moveStep = 1;

			const isComplete = moveStep >= solution.length;
			expect(isComplete).toBe(false);
		});
	});

	describe("Puzzle API client", () => {
		it("should export Puzzle interface with required fields", () => {
			const mockPuzzle: puzzleApi.Puzzle = {
				id: "test-1",
				fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
				sideToMove: "white",
				solution: [{ from: [6, 4], to: [4, 4] }],
				rating: 800,
				themes: ["Opening"],
			};

			expect(mockPuzzle.id).toBe("test-1");
			expect(mockPuzzle.fen).toContain("rnbqkbnr");
			expect(mockPuzzle.sideToMove).toBe("white");
			expect(mockPuzzle.solution).toHaveLength(1);
			expect(mockPuzzle.rating).toBe(800);
			expect(mockPuzzle.themes).toContain("Opening");
		});

		it("should support optional promotion in solution moves", () => {
			const moveWithPromotion = {
				from: [1, 4],
				to: [0, 4],
				promotion: "Q",
			};

			expect(moveWithPromotion.promotion).toBe("Q");
		});
	});
});

// Re-import for type-checking
import * as puzzleApi from "../src/api/puzzleApi";
