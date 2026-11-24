const chessEngine = require("../services/chessEngine");
const {
	computeZobristHash,
	getOpeningBookMove,
	squareToCoords,
	coordsToSquare,
} = require("../services/botHeuristics");

describe("botHeuristics - Opening Book (Issue #704)", () => {
	describe("computeZobristHash", () => {
		it("computes a consistent hash for the same board position", () => {
			const board = chessEngine.initBoard();
			const hash1 = computeZobristHash(board, "white");
			const hash2 = computeZobristHash(board, "white");
			expect(hash1).toBe(hash2);
		});

		it("produces different hashes for different positions", () => {
			const board1 = chessEngine.initBoard();
			const board2 = chessEngine.initBoard();
			board2[4][4] = "."; // Remove center pawn
			board2[3][4] = "P"; // Move it one square

			const hash1 = computeZobristHash(board1, "white");
			const hash2 = computeZobristHash(board2, "white");
			expect(hash1).not.toBe(hash2);
		});

		it("produces different hashes for white vs black to move", () => {
			const board = chessEngine.initBoard();
			const whiteHash = computeZobristHash(board, "white");
			const blackHash = computeZobristHash(board, "black");
			expect(whiteHash).not.toBe(blackHash);
		});

		it("generates a hex string hash", () => {
			const board = chessEngine.initBoard();
			const hash = computeZobristHash(board, "white");
			expect(typeof hash).toBe("string");
			expect(/^[0-9a-f]+$/.test(hash)).toBe(true);
		});

		it("handles empty board correctly", () => {
			const board = Array(8).fill(null).map(() => Array(8).fill("."));
			const hash = computeZobristHash(board, "white");
			expect(hash).toBeDefined();
			expect(hash.length > 0).toBe(true);
		});

		it("includes all piece types in hash calculation", () => {
			const board = Array(8).fill(null).map(() => Array(8).fill("."));

			// Test white pieces
			board[0][0] = "R"; // rook
			const rook_hash = computeZobristHash(board, "white");

			board[0][0] = "N"; // knight
			const knight_hash = computeZobristHash(board, "white");

			expect(rook_hash).not.toBe(knight_hash);
		});

		it("distinguishes between white and black pieces", () => {
			const board = Array(8).fill(null).map(() => Array(8).fill("."));
			board[0][0] = "R"; // white rook

			const whiteRookHash = computeZobristHash(board, "white");

			board[0][0] = "r"; // black rook
			const blackRookHash = computeZobristHash(board, "white");

			expect(whiteRookHash).not.toBe(blackRookHash);
		});
	});

	describe("getOpeningBookMove with Zobrist hashing", () => {
		it("returns a valid opening move from initial position", () => {
			const board = chessEngine.initBoard();
			const move = getOpeningBookMove(
				"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
				() => 0,
				board,
				"white"
			);
			expect(["e2e4", "d2d4", "c2c4", "g1f3"]).toContain(move);
		});

		it("accepts move selection via FEN without Zobrist hash", () => {
			const move = getOpeningBookMove(
				"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
			);
			expect(["e2e4", "d2d4", "c2c4", "g1f3"]).toContain(move);
		});

		it("returns null for unrecognized FEN positions", () => {
			const move = getOpeningBookMove(
				"8/8/8/8/8/8/8/8 w - - 0 1"
			);
			expect(move).toBeNull();
		});

		it("uses weighted random selection", () => {
			const board = chessEngine.initBoard();
			const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

			// With random=0, should get the first move (e2e4, weight 40)
			const move1 = getOpeningBookMove(fen, () => 0, board, "white");
			expect(move1).toBe("e2e4");

			// With a value that selects d2d4 (weight 30, cumulative 70)
			const move2 = getOpeningBookMove(fen, () => 0.5, board, "white");
			expect(["d2d4", "c2c4", "g1f3"]).toContain(move2);
		});

		it("handles deterministic random with seed", () => {
			const board = chessEngine.initBoard();
			const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

			const move1 = getOpeningBookMove(fen, () => 0.1, board, "white");
			const move2 = getOpeningBookMove(fen, () => 0.1, board, "white");
			expect(move1).toBe(move2);
		});

		it("returns null for invalid FEN", () => {
			const move = getOpeningBookMove(null);
			expect(move).toBeNull();

			const move2 = getOpeningBookMove(undefined);
			expect(move2).toBeNull();
		});
	});

	describe("Opening book content (Issue #704)", () => {
		it("includes the most popular first move (e2e4) with highest weight", () => {
			const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
			// With deterministic selection at 0, should get e2e4
			const move = getOpeningBookMove(fen, () => 0);
			expect(move).toBe("e2e4");
		});

		it("includes Sicilian Defense response after 1.e4", () => {
			const fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq";
			const move = getOpeningBookMove(fen);
			expect(["c7c5", "e7e5", "e7e6", "c7c6"]).toContain(move);
		});

		it("includes Queen's Gambit response after 1.d4", () => {
			const fen = "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq";
			const move = getOpeningBookMove(fen);
			expect(["g8f6", "d7d5", "e7e6", "g7g6"]).toContain(move);
		});

		it("includes Reti Opening response after 1.c4", () => {
			const fen = "rnbqkbnr/pppppppp/8/8/2P5/8/PP1PPPPP/RNBQKBNR b KQkq";
			const move = getOpeningBookMove(fen);
			expect(["e7e5", "c7c5", "e7e6", "g8f6"]).toContain(move);
		});
	});

	describe("squareToCoords and coordsToSquare (Issue #704)", () => {
		it("converts square notation to board coordinates", () => {
			expect(squareToCoords("a1")).toEqual([7, 0]);
			expect(squareToCoords("e4")).toEqual([4, 4]);
			expect(squareToCoords("h8")).toEqual([0, 7]);
		});

		it("converts board coordinates back to square notation", () => {
			expect(coordsToSquare([7, 0])).toBe("a1");
			expect(coordsToSquare([4, 4])).toBe("e4");
			expect(coordsToSquare([0, 7])).toBe("h8");
		});

		it("roundtrips correctly", () => {
			const squares = ["a1", "e4", "h8", "d5", "c3"];
			for (const square of squares) {
				const coords = squareToCoords(square);
				const roundtrip = coordsToSquare(coords);
				expect(roundtrip).toBe(square);
			}
		});
	});
});
