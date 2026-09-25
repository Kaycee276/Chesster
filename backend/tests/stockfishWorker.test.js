const fs = require("fs");
const os = require("os");
const path = require("path");
const chessEngine = require("../services/chessEngine");
const { createMoveHandler } = require("../workers/stockfishWorker");

const FAKE_ENGINE = path.join(__dirname, "fixtures", "fakeUciEngine.js");
const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1";

function task(overrides = {}) {
	return {
		fen: START_FEN,
		board: chessEngine.initBoard(),
		turn: "white",
		lastMove: null,
		skillLevel: 8,
		depth: 8,
		moveTimeMs: 200,
		deadline: Date.now() + 3000,
		...overrides,
	};
}

describe("stockfishWorker move handler", () => {
	let handler;
	let logFile;

	beforeEach(() => {
		logFile = path.join(os.tmpdir(), `fake-uci-${process.pid}-${Date.now()}.log`);
	});

	afterEach(() => {
		if (handler) handler.dispose();
		handler = null;
		fs.rmSync(logFile, { force: true });
	});

	it("returns the engine's bestmove and drives it with standard UCI commands", async () => {
		handler = createMoveHandler({ enginePath: process.execPath, engineArgs: [FAKE_ENGINE, "ok", logFile] });

		const result = await handler.computeMove(task({ skillLevel: 1, depth: 3 }));

		expect(result.engine).toBe("stockfish");
		expect(result.uci).toBe("e2e4");
		expect(result.move).toEqual({ from: [6, 4], to: [4, 4], promotion: null });

		const commands = fs.readFileSync(logFile, "utf8").trim().split("\n");
		expect(commands[0]).toBe("uci");
		expect(commands).toContain("setoption name Skill Level value 1");
		expect(commands).toContain(`position fen ${START_FEN}`);
		expect(commands.find((c) => c.startsWith("go"))).toBe("go depth 3 movetime 200");
	});

	it("keeps one engine process alive across requests", async () => {
		const pids = [];
		handler = createMoveHandler({
			enginePath: process.execPath,
			engineArgs: [FAKE_ENGINE, "ok", logFile],
			onEnginePid: (pid) => pids.push(pid),
		});

		await handler.computeMove(task());
		await handler.computeMove(task());

		expect(pids).toHaveLength(1);
		const commands = fs.readFileSync(logFile, "utf8").trim().split("\n");
		expect(commands.filter((c) => c === "uci")).toHaveLength(1);
		expect(commands.filter((c) => c.startsWith("go"))).toHaveLength(2);
	});

	it("caps the engine movetime to fit inside the task deadline", async () => {
		handler = createMoveHandler({ enginePath: process.execPath, engineArgs: [FAKE_ENGINE, "ok", logFile] });

		await handler.computeMove(task({ moveTimeMs: 10000, deadline: Date.now() + 1500 }));

		const go = fs.readFileSync(logFile, "utf8").split("\n").find((c) => c.startsWith("go"));
		const movetime = parseInt(go.split(" ").pop(), 10);
		expect(movetime).toBeLessThan(1500);
	});

	it("kills a hanging engine query and falls back to a legal move before the deadline", async () => {
		const pids = [];
		handler = createMoveHandler({
			enginePath: process.execPath,
			engineArgs: [FAKE_ENGINE, "hang"],
			onEnginePid: (pid) => pids.push(pid),
		});

		const startedAt = Date.now();
		const deadline = startedAt + 1000;
		const result = await handler.computeMove(task({ deadline }));

		expect(Date.now()).toBeLessThan(deadline);
		expect(result.engine).toBe("heuristic");
		expect(result.fallbackReason).toMatch(/timed out/);
		const board = chessEngine.initBoard();
		expect(chessEngine.isValidMove(board, result.move.from, result.move.to, "white", null).valid).toBe(true);
		// The hung engine was torn down (pid reported as gone).
		expect(pids[pids.length - 1]).toBeNull();
	});

	it("reports no move when the engine says there are no legal moves", async () => {
		handler = createMoveHandler({ enginePath: process.execPath, engineArgs: [FAKE_ENGINE, "none"] });

		const result = await handler.computeMove(task());

		expect(result.move).toBeNull();
		expect(result.engine).toBe("stockfish");
	});

	it("falls back to the heuristic and stops retrying a missing engine binary", async () => {
		handler = createMoveHandler({ enginePath: "definitely-not-a-real-stockfish-binary" });

		const first = await handler.computeMove(task());
		expect(first.engine).toBe("heuristic");
		expect(first.fallbackReason).toMatch(/ENOENT/);
		expect(first.uci).toMatch(/^[a-h][1-8][a-h][1-8][qrbn]?$/);

		const second = await handler.computeMove(task());
		expect(second.engine).toBe("heuristic");
		expect(second.fallbackReason).toBe("engine unavailable");
	});

	it("uses the heuristic directly when no engine is configured", async () => {
		handler = createMoveHandler({ enginePath: null });

		const result = await handler.computeMove(task());

		expect(result.engine).toBe("heuristic");
		expect(result.fallbackReason).toBe("no engine configured");
	});
});
