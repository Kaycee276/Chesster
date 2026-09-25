const path = require("path");
const chessEngine = require("../services/chessEngine");
const botService = require("../services/botService");

const { BotService, BotWorkerPool } = botService;
const FAKE_ENGINE = path.join(__dirname, "fixtures", "fakeUciEngine.js");

describe("BotService", () => {
	afterAll(() => botService.shutdown());
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

	describe("resolveDifficulty", () => {
		it("maps the Beginner / Intermediate / Master tiers to skill levels and search depths", () => {
			expect(botService.resolveDifficulty("beginner")).toEqual({ skillLevel: 1, depth: 3 });
			expect(botService.resolveDifficulty("intermediate")).toEqual({ skillLevel: 8, depth: 8 });
			expect(botService.resolveDifficulty("master")).toEqual({ skillLevel: 20, depth: 20 });
		});

		it("accepts tier names case-insensitively", () => {
			expect(botService.resolveDifficulty(" Master ")).toEqual(botService.resolveDifficulty("master"));
		});

		it("increases search depth with difficulty", () => {
			const depths = ["beginner", "intermediate", "master"].map((d) => botService.resolveDifficulty(d).depth);
			expect(depths).toEqual([...depths].sort((a, b) => a - b));
		});

		it("derives a bounded depth for numeric skill levels", () => {
			expect(botService.resolveDifficulty(0)).toEqual({ skillLevel: 0, depth: 3 });
			expect(botService.resolveDifficulty(20).depth).toBeLessThanOrEqual(22);
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
			expect(move.uci).toMatch(/^[a-h][1-8][a-h][1-8][qrbn]?$/);
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

	describe("getBestMove via the worker pool and a UCI engine", () => {
		let bot;

		afterEach(() => bot.shutdown());

		it("returns the engine's UCI move, computed in a worker thread", async () => {
			bot = new BotService(new BotWorkerPool({
				size: 1,
				workerData: { enginePath: process.execPath, engineArgs: [FAKE_ENGINE, "ok"] },
			}));

			const move = await bot.getBestMove(chessEngine.initBoard(), "white", null, "master", 0);

			expect(move).toEqual({
				from: [6, 4],
				to: [4, 4],
				promotion: null,
				uci: "e2e4",
				engine: "stockfish",
				skillLevel: 20,
				depth: 20,
			});
		});

		it("falls back to a legal move when the engine query hangs past the timeout budget", async () => {
			bot = new BotService(new BotWorkerPool({
				size: 1,
				taskTimeoutMs: 800,
				workerData: { enginePath: process.execPath, engineArgs: [FAKE_ENGINE, "hang"] },
			}));
			const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

			const board = chessEngine.initBoard();
			const startedAt = Date.now();
			const move = await bot.getBestMove(board, "white", null, "intermediate", 0);

			expect(Date.now() - startedAt).toBeLessThan(800);
			expect(move.engine).toBe("heuristic");
			expect(chessEngine.isValidMove(board, move.from, move.to, "white", null).valid).toBe(true);
			expect(warn).toHaveBeenCalledWith(expect.stringMatching(/timed out/));
			warn.mockRestore();
		});
	});
});
