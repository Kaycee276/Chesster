jest.mock("../models/gameModel", () => ({ getGame: jest.fn(), makeMove: jest.fn() }));
const path = require("path");
const chessEngine = require("../services/chessEngine");
const botService = require("../services/botService");

const { StockfishPool: BotWorkerPool } = require("../services/stockfishPool");

const { BotService } = botService;
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
		it("selects a weighted move from the initial ECO position", () => {
			const move = botService.getOpeningBookMove(
				"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
				() => 0,
			);
			expect(["e2e4", "d2d4", "c2c4", "g1f3"]).toContain(move);
		});
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

		it("maps bot levels 1-8 onto increasing skill level and depth", () => {
			const resolved = [1, 2, 3, 4, 5, 6, 7, 8].map((level) => botService.resolveDifficulty({ level }));

			expect(resolved[0]).toEqual({ skillLevel: 0, depth: 1 });
			expect(resolved[7]).toEqual({ skillLevel: 20, depth: 20 });
			for (let i = 1; i < resolved.length; i++) {
				expect(resolved[i].skillLevel).toBeGreaterThan(resolved[i - 1].skillLevel);
				expect(resolved[i].depth).toBeGreaterThan(resolved[i - 1].depth);
			}
			resolved.forEach(({ skillLevel }) => {
				expect(skillLevel).toBeGreaterThanOrEqual(0);
				expect(skillLevel).toBeLessThanOrEqual(20);
			});
		});

		it("spans the Beginner (800) to Grandmaster (2500) ELO range", () => {
			expect(botService.BOT_LEVELS[1].elo).toBe(800);
			expect(botService.BOT_LEVELS[8].elo).toBe(2500);
		});

		it("only accepts integer levels 1-8", () => {
			expect([1, 8].every(botService.isValidBotLevel)).toBe(true);
			expect([0, 9, 2.5, "3", null, undefined].some(botService.isValidBotLevel)).toBe(false);
			expect(botService.resolveDifficulty({ level: 99 })).toEqual(botService.resolveDifficulty("medium"));
		});
	});

	describe("getBestMove", () => {
		it("falls back to a legal heuristic move when Stockfish is unavailable", async () => {
			// No STOCKFISH_PATH binary exists in the test environment, so this
			// exercises the heuristic fallback path end-to-end.
			const board = chessEngine.initBoard();
			const move = await botService.getBestMove(board, "white", null, "easy", 12);

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

			const move = await botService.getBestMove(board, "black", null, "easy", 12);
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

			const move = await bot.getBestMove(chessEngine.initBoard(), "white", null, "master", 12);

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
			const move = await bot.getBestMove(board, "white", null, "intermediate", 12);

			expect(Date.now() - startedAt).toBeLessThan(800);
			expect(move.engine).toBe("heuristic");
			expect(chessEngine.isValidMove(board, move.from, move.to, "white", null).valid).toBe(true);
			expect(warn).toHaveBeenCalledWith(expect.stringMatching(/timed out/));
			warn.mockRestore();
		});
	});
});

describe("BotService input boundaries and deterministic fuzz cases", () => {
	const STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 7";
	const reply = { move: { from: [6, 4], to: [4, 4], promotion: null }, uci: "e2e4", engine: "stockfish" };
	let pool;
	let bot;

	beforeEach(() => {
		pool = { executeMove: jest.fn().mockResolvedValue(reply), run: jest.fn().mockResolvedValue({ bestMove: "e2e4", scoreCp: 20 }), destroy: jest.fn().mockResolvedValue() };
		bot = new BotService(pool);
	});

	afterEach(() => bot.shutdown());

	it.each([-9999, -1, 0, 20, 99, Number.MAX_VALUE])("clamps numeric difficulty %p and its search depth", async (difficulty) => {
		const move = await bot.getBestMove(chessEngine.initBoard(), "white", null, difficulty, 12);
		expect(move.skillLevel).toBe(Math.max(0, Math.min(20, Math.round(difficulty))));
		expect(move.depth).toBeGreaterThanOrEqual(1);
		expect(move.depth).toBeLessThanOrEqual(20);
	});

	it.each(["constructor", "__proto__", "toString", NaN, Infinity, -Infinity])("resolves unsafe difficulty %p to the medium preset", (difficulty) => {
		expect(botService.resolveDifficulty(difficulty)).toEqual({ skillLevel: 10, depth: 10 });
	});

	it("caps the legacy maximum preset at depth 20", () => {
		expect(botService.resolveDifficulty("maximum")).toEqual({ skillLevel: 20, depth: 20 });
	});

	it.each([[-9999, 1], [0, 1], [1, 1], [20, 20], [9999, 20], [10.9, 10]])("bounds explicit depth %p at %p", async (depth, expected) => {
		await bot.getBestMove(chessEngine.initBoard(), "white", null, "master", 12, { depth });
		expect(pool.executeMove.mock.calls[0][0].depth).toBe(expected);
		await bot.analyzeFen(STARTING_FEN, depth);
		expect(pool.run.mock.calls[0][0].depth).toBe(expected);
	});

	it.each([NaN, Infinity, -Infinity, "20", null, {}, []])("rejects invalid depth %p before allocating an engine", async (depth) => {
		await expect(bot.getBestMove(chessEngine.initBoard(), "white", null, "master", 12, { depth })).rejects.toMatchObject({ code: "BOT_INVALID_INPUT" });
		await expect(bot.analyzeFen(STARTING_FEN, depth)).rejects.toMatchObject({ code: "BOT_INVALID_INPUT" });
		expect(pool.executeMove).not.toHaveBeenCalled();
		expect(pool.run).not.toHaveBeenCalled();
	});

	it.each([0, -1, NaN, Infinity, "500", null, 0.5])("rejects an invalid time limit %p without queueing work", async (timeLimitMs) => {
		await expect(bot.getBestMove(chessEngine.initBoard(), "white", null, "master", 12, { timeLimitMs })).rejects.toMatchObject({ code: "BOT_INVALID_INPUT" });
		expect(pool.executeMove).not.toHaveBeenCalled();
	});

	it("caps the client deadline and supplies a bounded engine move time", async () => {
		await bot.getBestMove(chessEngine.initBoard(), "white", null, "master", 12, { timeLimitMs: Number.MAX_SAFE_INTEGER });
		const [payload, options] = pool.executeMove.mock.calls[0];
		expect(options).toEqual({ timeoutMs: 3000, queueTimeoutMs: 3000 });
		expect(payload.moveTimeMs).toBeGreaterThan(0);
		expect(payload.moveTimeMs).toBeLessThanOrEqual(3000);
	});

	it.each([
		"not-a-valid-chess-fen-position",
		"8/8/8/8/8/8/8/8 w - - 0 1",
		"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNK w - - 0 1",
		"p3k3/8/8/8/8/8/8/4K3 w - - 0 1",
		"4k3/8/8/8/8/8/8/4K2P w - - 0 1",
		"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KK - 0 1",
		"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 0",
		STARTING_FEN + "\nquit",
		STARTING_FEN + " extra",
		null,
		{ fen: STARTING_FEN },
	])("rejects malformed FEN %p before analysis or move dispatch", async (fen) => {
		await expect(bot.analyzeFen(fen)).rejects.toMatchObject({ code: "BOT_INVALID_INPUT", message: expect.stringMatching(/invalid fen/i) });
		await expect(bot.getBestMoveFromFen(fen)).rejects.toMatchObject({ code: "BOT_INVALID_INPUT", message: expect.stringMatching(/invalid fen/i) });
		expect(pool.run).not.toHaveBeenCalled();
		expect(pool.executeMove).not.toHaveBeenCalled();
	});

	it("preserves the validated FEN, active side and castling rights in worker input", async () => {
		await bot.getBestMoveFromFen(STARTING_FEN, 20, { depth: 99, timeLimitMs: 500 });
		expect(pool.executeMove).toHaveBeenCalledWith(expect.objectContaining({
			fen: STARTING_FEN, board: chessEngine.initBoard(), turn: "white", depth: 20,
			skillLevel: 20, moveTimeMs: 500,
		}), { timeoutMs: 500, queueTimeoutMs: 500 });
	});

	it("normalizes FEN whitespace before dispatch and preserves a legal en passant history", async () => {
		const fen = "4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 7";
		await bot.getBestMoveFromFen("  " + fen.replace(/ /g, "  ") + "  ", "master");
		expect(pool.executeMove.mock.calls[0][0]).toMatchObject({
			fen, turn: "white", lastMove: { from: [1, 3], to: [3, 3], piece: "p" },
		});
	});

	it("rejects sparse boards and invalid FEN metadata without allocating workers", async () => {
		const sparse = chessEngine.initBoard().map((row, index) => index === 3 ? new Array(8) : row);
		await expect(bot.getBestMove(sparse, "white")).rejects.toMatchObject({ code: "BOT_INVALID_INPUT" });
		await expect(bot.getBestMoveFromFen("4k3/8/8/8/8/8/8/4K3 w - d6 0 7")).rejects.toMatchObject({ code: "BOT_INVALID_INPUT" });
		await expect(bot.getBestMoveFromFen("rnbqkbnr/pppppppp/88/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 7")).rejects.toMatchObject({ code: "BOT_INVALID_INPUT" });
		expect(pool.executeMove).not.toHaveBeenCalled();
	});

	it.each([[], [["."]], Array(8).fill(Array(8).fill(".")), "not-a-board", null])("rejects malformed board %p before engine dispatch", async (board) => {
		await expect(bot.getBestMove(board, "white", null, "master", 12)).rejects.toMatchObject({ code: "BOT_INVALID_INPUT" });
		expect(pool.executeMove).not.toHaveBeenCalled();
	});

	it("rejects invalid turns and move history before opening-book or engine work", async () => {
		await expect(bot.getBestMove(chessEngine.initBoard(), "green")).rejects.toMatchObject({ code: "BOT_INVALID_INPUT" });
		await expect(bot.getBestMove(chessEngine.initBoard(), "white", { from: [-1, 0], to: [2, 0], piece: "p" })).rejects.toMatchObject({ code: "BOT_INVALID_INPUT" });
		await expect(bot.getBestMove(chessEngine.initBoard(), "white", null, 20, -1)).rejects.toMatchObject({ code: "BOT_INVALID_INPUT" });
		expect(pool.executeMove).not.toHaveBeenCalled();
	});

	it("fuzzes bounded engine options and malformed UCI strings from a fixed seed", async () => {
		let seed = 764;
		const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
		const board = Object.freeze(chessEngine.initBoard().map((row) => Object.freeze([...row])));
		for (let index = 0; index < 64; index += 1) {
			const difficulty = (next() % 4000) - 2000;
			const depth = (next() % 4000) - 2000;
			const malformedUci = ":" + next().toString(36);
			expect(botService.parseUciMove(malformedUci)).toBeNull();
			const move = await bot.getBestMove(board, "white", null, difficulty, 12, { depth });
			expect(move.skillLevel).toBeGreaterThanOrEqual(0);
			expect(move.skillLevel).toBeLessThanOrEqual(20);
			expect(move.depth).toBeGreaterThanOrEqual(1);
			expect(move.depth).toBeLessThanOrEqual(20);
		}
		expect(pool.executeMove).toHaveBeenCalledTimes(64);
	});

	it("preserves legal knight underpromotions from the UCI engine", async () => {
		const realPool = new BotWorkerPool({
			size: 1, taskTimeoutMs: 3000,
			workerData: { enginePath: process.execPath, engineArgs: [FAKE_ENGINE, "promotion"] },
		});
		const realBot = new BotService(realPool);
		const board = Array.from({ length: 8 }, (_, row) => Array.from({ length: 8 }, (_, col) =>
			row === 0 && col === 4 ? "k" : row === 1 && col === 0 ? "P" : row === 7 && col === 4 ? "K" : "."));
		try {
			await expect(realBot.getBestMove(board, "white", null, "master", 12)).resolves.toMatchObject({
				engine: "stockfish", uci: "a7a8n", promotion: "n",
			});
		} finally {
			await realBot.shutdown();
		}
	});

	it.each(["invalid", "illegal"])("survives %s UCI output and releases the engine during shutdown", async (mode) => {
		const realPool = new BotWorkerPool({
			size: 1, taskTimeoutMs: 3000,
			workerData: { enginePath: process.execPath, engineArgs: [FAKE_ENGINE, mode] },
		});
		const realBot = new BotService(realPool);
		const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const board = chessEngine.initBoard();
			const move = await realBot.getBestMove(board, "white", null, "master", 12);
			expect(move.engine).toBe("heuristic");
			expect(chessEngine.isValidMove(board, move.from, move.to, "white", null).valid).toBe(true);
			expect(warn).toHaveBeenCalledWith(expect.stringMatching(/unparseable engine move|illegal engine move/));
			expect(realPool.stats()).toMatchObject({ busy: 0, queued: 0 });
		} finally {
			await realBot.shutdown();
			warn.mockRestore();
		}
		expect(realPool.stats()).toMatchObject({ workers: 0, busy: 0, queued: 0 });
	});
});

describe("bot route boundary responses with the real service", () => {
	const express = require("express");
	const request = require("supertest");
	let app;

	beforeEach(() => {
		app = express();
		app.use(express.json());
		app.use("/api", require("../routes/botRoutes"));
	});

	it.each([
		{ fen: "corrupted-fen", difficulty: 5 },
		{ fen: "8/8/8/8/8/8/8/8 w - - 0 1", difficulty: 5 },
		{ board: [["."]], turn: "white" },
		{ board: chessEngine.initBoard(), turn: "white", depth: "quit" },
		{ board: chessEngine.initBoard(), turn: "white", timeLimitMs: -1 },
	])("returns 400 for invalid client input %p", async (body) => {
		const res = await request(app).post("/api/bot/move").send(body);
		expect(res.status).toBe(400);
		expect(res.body.success).toBe(false);
		expect(res.body.error).toBeTruthy();
	});
});

describe("FEN-aware castling in bot engine replies", () => {
	const { isLegalCastlingMove } = require("../workers/stockfishWorker");

	it.each([
		["4k3/8/8/8/8/8/8/4K2R w K - 0 7", "e1g1", true],
		["4k3/8/8/8/8/8/8/R3K3 w Q - 0 7", "e1c1", true],
		["4k2r/8/8/8/8/8/8/4K3 b k - 0 7", "e8g8", true],
		["r3k3/8/8/8/8/8/8/4K3 b q - 0 7", "e8c8", true],
		["4k3/8/8/8/8/8/8/4K2R w - - 0 7", "e1g1", false],
		["4k3/8/8/8/8/8/8/4K3 w K - 0 7", "e1g1", false],
		["4k3/8/8/8/8/8/8/3K3R w K - 0 7", "d1f1", false],
		["4k3/8/8/8/8/8/8/4KN1R w K - 0 7", "e1g1", false],
		["4k3/8/8/8/8/8/8/RN2K3 w Q - 0 7", "e1c1", false],
		["4k3/8/8/8/8/8/4r3/4K2R w K - 0 7", "e1g1", false],
		["4kr2/8/8/8/8/8/8/4K2R w K - 0 7", "e1g1", false],
		["4k1r1/8/8/8/8/8/8/4K2R w K - 0 7", "e1g1", false],
		["4k3/8/8/8/8/8/8/4K2R w K - 0 7", "e1g1q", false],
	])("validates castling for %s and %s as %s", (fen, uci, expected) => {
		const { board, currentColor: turn } = chessEngine.fenToBoard(fen);
		expect(isLegalCastlingMove({ fen, board, turn }, botService.parseUciMove(uci))).toBe(expected);
	});

	it.each([
		["4k3/8/8/8/8/8/8/4K2R w K - 0 7", "stockfish"],
		["4k3/8/8/8/8/8/8/4K2R w - - 0 7", "heuristic"],
	])("accepts a real engine castling reply only when FEN grants the right: %s", async (fen, engine) => {
		const pool = new BotWorkerPool({
			size: 1, taskTimeoutMs: 3000,
			workerData: { enginePath: process.execPath, engineArgs: [FAKE_ENGINE, "castle"] },
		});
		const bot = new BotService(pool);
		const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const move = await bot.getBestMoveFromFen(fen, "master");
			expect(move.engine).toBe(engine);
			if (engine === "stockfish") {
				expect(move).toMatchObject({ uci: "e1g1", from: [7, 4], to: [7, 6], promotion: null });
			} else {
				expect(move.uci).not.toBe("e1g1");
				expect(warn).toHaveBeenCalledWith(expect.stringMatching(/illegal engine move/));
			}
		} finally {
			await bot.shutdown();
			warn.mockRestore();
		}
	});
});
