/**
 * Load test for Issue #241: while many bot moves are being calculated
 * concurrently, the main event loop (which serves HTTP + WebSocket traffic)
 * must stay responsive — event loop lag under 15ms.
 */
const path = require("path");
const { monitorEventLoopDelay } = require("perf_hooks");
const chessEngine = require("../services/chessEngine");
const { BotService, BotWorkerPool } = require("../services/botService");
const { pickHeuristicMove } = require("../services/botHeuristics");

const TEST_WORKER = path.join(__dirname, "fixtures", "poolTestWorker.js");
const MAX_LAG_MS = 15;

jest.setTimeout(30000);

/** Record event loop delay (in ms) while `work()` runs. */
async function measureLag(work) {
	const histogram = monitorEventLoopDelay({ resolution: 1 });
	histogram.enable();
	try {
		await work();
	} finally {
		histogram.disable();
	}
	return { p99: histogram.percentile(99) / 1e6, max: histogram.max / 1e6 };
}

/**
 * Event loop lag *added* by `work()`, relative to an idle loop measured the
 * same way. The idle baseline absorbs platform timer granularity (on
 * Windows every timer tick is ~15.6ms even with nothing running), so only
 * delay caused by the workload is compared against the budget.
 */
async function measureAddedLag(work) {
	const idle = await measureLag(() => new Promise((resolve) => setTimeout(resolve, 300)));
	const loaded = await measureLag(work);
	return { p99: Math.max(0, loaded.p99 - idle.p99), loaded, idle };
}

/** A few distinct middlegame-ish positions so workers do real move generation. */
function positions() {
	const start = chessEngine.initBoard();
	const open = chessEngine.initBoard();
	open[6][4] = ".";
	open[4][4] = "P";
	open[1][4] = ".";
	open[3][4] = "p";
	open[7][6] = ".";
	open[5][5] = "N";
	open[0][1] = ".";
	open[2][2] = "n";
	return [
		{ board: start, turn: "white" },
		{ board: open, turn: "black" },
		{ board: open, turn: "white" },
	];
}

describe("bot worker pool load", () => {
	let pool;

	afterEach(async () => {
		if (pool) await pool.destroy();
		pool = null;
	});

	it("detects blocking when the same kind of work runs on the main thread (control)", async () => {
		const lag = await measureLag(async () => {
			await new Promise((resolve) => setTimeout(resolve, 5));
			const end = Date.now() + 120;
			while (Date.now() < end) { /* simulate an in-process engine search */ }
			await new Promise((resolve) => setTimeout(resolve, 5));
		});

		expect(lag.max).toBeGreaterThan(100);
	});

	it(`keeps event loop lag under ${MAX_LAG_MS}ms while workers burn CPU on engine searches`, async () => {
		pool = new BotWorkerPool({ workerScript: TEST_WORKER, taskTimeoutMs: 20000 });
		pool.warmup();
		await Promise.all(Array.from({ length: pool.size }, () => pool.executeMove({})));

		const lag = await measureAddedLag(() =>
			Promise.all(Array.from({ length: 24 }, (_, i) => pool.executeMove({ mode: "spin", ms: 120, label: i }))),
		);

		expect(lag.p99).toBeLessThan(MAX_LAG_MS);
	});

	it(`serves concurrent bot matches through BotService with lag under ${MAX_LAG_MS}ms`, async () => {
		pool = new BotWorkerPool({ workerData: { enginePath: null }, taskTimeoutMs: 20000 });
		const bot = new BotService(pool);
		pool.warmup();
		const games = positions();
		await Promise.all(games.map((g) => bot.getBestMove(g.board, g.turn, null, "master", 10)));

		let moves = [];
		const lag = await measureAddedLag(async () => {
			moves = await Promise.all(
				Array.from({ length: 60 }, (_, i) => {
					const g = games[i % games.length];
					return bot.getBestMove(g.board, g.turn, null, ["beginner", "intermediate", "master"][i % 3], 10);
				}),
			);
		});

		expect(lag.p99).toBeLessThan(MAX_LAG_MS);
		moves.forEach((move, i) => {
			const g = games[i % games.length];
			expect(move.uci).toMatch(/^[a-h][1-8][a-h][1-8][qrbn]?$/);
			expect(chessEngine.isValidMove(g.board, move.from, move.to, g.turn, null).valid).toBe(true);
		});
	});

	it("shows the same workload would have blocked the loop if run in-process", async () => {
		const games = positions();
		const lag = await measureLag(async () => {
			await new Promise((resolve) => setTimeout(resolve, 5));
			for (let i = 0; i < 60; i++) {
				const g = games[i % games.length];
				pickHeuristicMove(g.board, g.turn, null, 20);
			}
			await new Promise((resolve) => setTimeout(resolve, 5));
		});

		expect(lag.max).toBeGreaterThan(MAX_LAG_MS);
	});
});
