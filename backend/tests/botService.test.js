const chessEngine = require("../services/chessEngine");
const botService = require("../services/botService");

describe("BotService", () => {
	describe("boardToFEN", () => {
		it("converts the initial board to the standard starting FEN placement", () => {
			const board = chessEngine.initBoard();
			const fen = botService.boardToFEN(board, "white", 0);
			expect(fen).toBe("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1");
		});

		it("marks black to move when turn is black", () => {
			const board = chessEngine.initBoard();
			const fen = botService.boardToFEN(board, "black", 1);
			expect(fen.split(" ")[1]).toBe("b");
		});
	});

	describe("parseUciMove", () => {
		it("parses a simple move", () => {
			const move = botService.parseUciMove("e2e4");
			expect(move.from).toEqual([6, 4]);
			expect(move.to).toEqual([4, 4]);
			expect(move.promotion).toBeNull();
		});

		it("parses a promotion move", () => {
			const move = botService.parseUciMove("e7e8q");
			expect(move.from).toEqual([1, 4]);
			expect(move.to).toEqual([0, 4]);
			expect(move.promotion).toBe("q");
		});

		it("returns null for garbage input", () => {
			expect(botService.parseUciMove("")).toBeNull();
			expect(botService.parseUciMove(null)).toBeNull();
		});
	});

	describe("getLegalMoves", () => {
		it("finds the 20 legal opening moves for white", () => {
			const board = chessEngine.initBoard();
			const moves = botService.getLegalMoves(board, "white", null);
			expect(moves.length).toBe(20);
		});
	});

	describe("resolveSkillLevel", () => {
		it("maps difficulty presets to UCI skill levels", () => {
			expect(botService.resolveSkillLevel("easy")).toBe(2);
			expect(botService.resolveSkillLevel("medium")).toBe(10);
			expect(botService.resolveSkillLevel("hard")).toBe(18);
		});

		it("clamps numeric skill levels to 0-20", () => {
			expect(botService.resolveSkillLevel(-5)).toBe(0);
			expect(botService.resolveSkillLevel(99)).toBe(20);
			expect(botService.resolveSkillLevel(12)).toBe(12);
		});

		it("defaults to medium for unknown input", () => {
			expect(botService.resolveSkillLevel(undefined)).toBe(10);
			expect(botService.resolveSkillLevel("nonsense")).toBe(10);
		});
	});

	describe("getBestMove", () => {
		it("falls back to a legal heuristic move when Stockfish is unavailable", async () => {
			// No STOCKFISH_PATH binary exists in the test environment, so this
			// exercises the heuristic fallback path end-to-end.
			const board = chessEngine.initBoard();
			const move = await botService.getBestMove(board, "white", null, "easy", 0);

			expect(move).not.toBeNull();
			expect(move.engine).toBe("heuristic");
			const result = chessEngine.isValidMove(board, move.from, move.to, "white", null);
			expect(result.valid).toBe(true);
		});

		it("returns null when the side to move has no legal moves", async () => {
			// Classic stalemate position: black king a8, white king c7, white
			// queen b6 — black to move has zero legal moves and isn't in check.
			const board = Array(8).fill(null).map(() => Array(8).fill("."));
			board[0][0] = "k"; // black king a8
			board[1][2] = "K"; // white king c7
			board[2][1] = "Q"; // white queen b6

			const move = await botService.getBestMove(board, "black", null, "easy", 0);
			expect(move).toBeNull();
		});
	});
});
