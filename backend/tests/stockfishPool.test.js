const path = require("path");
const { StockfishPool, PRIORITY, configuredPoolSize, defaultPoolSize } = require("../services/stockfishPool");
const { BotService } = require("../services/botService");

const TEST_WORKER = path.join(__dirname, "fixtures", "poolTestWorker.js");
const FAKE_ENGINE = path.join(__dirname, "fixtures", "fakeUciEngine.js");

function isAlive(pid) {
	try {
		process.kill(pid, 0);
		if (process.platform === "linux") {
			try {
				const status = require("fs").readFileSync(`/proc/${pid}/status`, "utf8");
				if (/State:\s+Z/i.test(status)) return false;
			} catch (_) {
				return false;
			}
		}
		return true;
	} catch (_) {
		return false;
	}
}

async function waitFor(condition, timeoutMs = 3000) {
	const end = Date.now() + timeoutMs;
	while (Date.now() < end) {
		if (condition()) return true;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	return condition();
}

describe("StockfishPool", () => {
	let pool;

	afterEach(async () => {
		if (pool) await pool.destroy();
		pool = null;
	});

	describe("configuration", () => {
		it("reads concurrency from BOT_MAX_CONCURRENCY, then BOT_WORKER_POOL_SIZE", () => {
			expect(configuredPoolSize({ BOT_MAX_CONCURRENCY: "3", BOT_WORKER_POOL_SIZE: "2" })).toBe(3);
			expect(configuredPoolSize({ BOT_WORKER_POOL_SIZE: "2" })).toBe(2);
			expect(configuredPoolSize({})).toBe(defaultPoolSize());
			expect(configuredPoolSize({ BOT_MAX_CONCURRENCY: "not-a-number" })).toBe(defaultPoolSize());
		});

		it("defaults to at most 4 workers", () => {
			expect(defaultPoolSize()).toBeGreaterThanOrEqual(1);
			expect(defaultPoolSize()).toBeLessThanOrEqual(4);
		});
	});

	describe("queued execution", () => {
		it("never runs more than `size` tasks at once under 50 simultaneous requests", async () => {
			pool = new StockfishPool({ size: 2, workerScript: TEST_WORKER, taskTimeoutMs: 10000 });

			let maxBusy = 0;
			const sample = setInterval(() => {
				maxBusy = Math.max(maxBusy, pool.stats().busy);
			}, 2);
			const threadIds = new Set();
			try {
				const results = await Promise.all(
					Array.from({ length: 50 }, (_, i) => pool.executeMove({ mode: "spin", ms: 10, label: i })),
				);
				results.forEach((result) => threadIds.add(result.threadId));
				expect(results.map((result) => result.label)).toEqual(Array.from({ length: 50 }, (_, i) => i));
			} finally {
				clearInterval(sample);
			}

			expect(maxBusy).toBeLessThanOrEqual(2);
			expect(threadIds.size).toBeLessThanOrEqual(2);
			expect(pool.stats()).toMatchObject({ workers: 2, busy: 0, queued: 0 });
		});

		it("runs live moves ahead of queued background analysis", async () => {
			pool = new StockfishPool({ size: 1, workerScript: TEST_WORKER });

			const order = [];
			const running = pool.executeMove({ mode: "spin", ms: 50, label: "running" });
			const tasks = [
				pool.run({ label: "analysis-1" }, { priority: PRIORITY.ANALYSIS }),
				pool.run({ label: "analysis-2" }, { priority: PRIORITY.ANALYSIS }),
				pool.executeMove({ label: "move-1" }),
				pool.executeMove({ label: "move-2" }),
			].map((task) => task.then((result) => order.push(result.label)));

			await Promise.all([running, ...tasks]);
			expect(order).toEqual(["move-1", "move-2", "analysis-1", "analysis-2"]);
		});

		it("keeps one engine free for live moves while background analysis is running", async () => {
			pool = new StockfishPool({ size: 2, workerScript: TEST_WORKER, taskTimeoutMs: 10000 });
			pool.warmup();

			const order = [];
			const analyses = ["analysis-1", "analysis-2"].map((label) =>
				pool.run({ mode: "spin", ms: 300, label }, { priority: PRIORITY.ANALYSIS }).then((r) => order.push(r.label)),
			);
			expect(pool.stats()).toMatchObject({ busy: 1, queued: 1 });

			await pool.executeMove({ mode: "spin", ms: 10, label: "move" }).then((r) => order.push(r.label));
			await Promise.all(analyses);

			expect(order).toEqual(["move", "analysis-1", "analysis-2"]);
		});

		it("lets background work use the only engine of a single-worker pool", async () => {
			pool = new StockfishPool({ size: 1, workerScript: TEST_WORKER });

			await expect(pool.run({ label: "analysis" }, { priority: PRIORITY.ANALYSIS })).resolves.toMatchObject({ label: "analysis" });
		});

		it("evicts the least urgent queued task when a live move arrives at a full queue", async () => {
			pool = new StockfishPool({ size: 1, workerScript: TEST_WORKER, maxQueueSize: 1 });

			const running = pool.executeMove({ mode: "spin", ms: 50 });
			const analysis = pool.run({ label: "analysis" }, { priority: PRIORITY.ANALYSIS });
			const move = pool.executeMove({ label: "move" });

			await expect(analysis).rejects.toMatchObject({ code: "BOT_QUEUE_FULL" });
			await expect(move).resolves.toMatchObject({ label: "move" });
			await running;
		});

		it("does not evict an equally urgent task", async () => {
			pool = new StockfishPool({ size: 1, workerScript: TEST_WORKER, maxQueueSize: 1 });

			const running = pool.executeMove({ mode: "spin", ms: 50 });
			const queued = pool.executeMove({ label: "queued" });

			await expect(pool.executeMove({})).rejects.toMatchObject({ code: "BOT_QUEUE_FULL" });
			await expect(queued).resolves.toMatchObject({ label: "queued" });
			await running;
		});
	});

	describe("timeouts", () => {
		it("rejects a stale queued task with BOT_TIMEOUT without disturbing the running one", async () => {
			pool = new StockfishPool({ size: 1, workerScript: TEST_WORKER, queueTimeoutMs: 100 });

			const running = pool.executeMove({ mode: "spin", ms: 400, label: "running" });
			const startedAt = Date.now();
			await expect(pool.executeMove({ label: "stale" })).rejects.toMatchObject({ code: "BOT_TIMEOUT" });
			expect(Date.now() - startedAt).toBeLessThan(400);
			expect(pool.stats().queued).toBe(0);

			await expect(running).resolves.toMatchObject({ label: "running" });
			await expect(pool.executeMove({ label: "after" })).resolves.toMatchObject({ label: "after" });
		});

		it("does not expire a task once it has been dispatched", async () => {
			pool = new StockfishPool({ size: 1, workerScript: TEST_WORKER, queueTimeoutMs: 50 });

			await expect(pool.executeMove({ mode: "spin", ms: 150, label: "slow" })).resolves.toMatchObject({ label: "slow" });
		});

		it("applies a per-task execution timeout and kills the hanging engine", async () => {
			pool = new StockfishPool({ size: 1, workerScript: TEST_WORKER, taskTimeoutMs: 10000 });
			// Start the worker thread first so its boot time doesn't eat the timeout budget.
			await pool.executeMove({ label: "warm" });

			const hung = pool.run({ mode: "hang" }, { timeoutMs: 300 });
			expect(await waitFor(() => pool.workers[0] && pool.workers[0].enginePid)).toBeTruthy();
			const enginePid = pool.workers[0].enginePid;

			const startedAt = Date.now();
			await expect(hung).rejects.toMatchObject({ code: "BOT_TIMEOUT" });
			expect(Date.now() - startedAt).toBeLessThan(1000);
			expect(await waitFor(() => !isAlive(enginePid))).toBe(true);
		});
	});

	describe("graceful shutdown", () => {
		it("kills in-flight engines, rejects pending work and leaves no workers behind", async () => {
			pool = new StockfishPool({ size: 1, workerScript: TEST_WORKER, queueTimeoutMs: 60000 });

			const hung = expect(pool.executeMove({ mode: "hang" })).rejects.toMatchObject({ code: "BOT_POOL_CLOSED" });
			const queued = expect(pool.run({ label: "queued" }, { priority: PRIORITY.ANALYSIS }))
				.rejects.toMatchObject({ code: "BOT_POOL_CLOSED" });
			expect(await waitFor(() => pool.workers[0] && pool.workers[0].enginePid)).toBeTruthy();
			const enginePid = pool.workers[0].enginePid;

			await pool.destroy();

			await hung;
			await queued;
			expect(pool.stats()).toMatchObject({ workers: 0, queued: 0 });
			expect(await waitFor(() => !isAlive(enginePid))).toBe(true);
		});

		it("BotService.shutdown() tears down its pool so a SIGINT handler can await it", async () => {
			const bot = new BotService(new StockfishPool({ size: 1, workerScript: TEST_WORKER }));
			const ownPool = bot.pool;
			const hung = expect(ownPool.executeMove({ mode: "hang" })).rejects.toMatchObject({ code: "BOT_POOL_CLOSED" });
			expect(await waitFor(() => ownPool.workers[0] && ownPool.workers[0].enginePid)).toBeTruthy();
			const enginePid = ownPool.workers[0].enginePid;

			await bot.shutdown();

			await hung;
			expect(await waitFor(() => !isAlive(enginePid))).toBe(true);
		});
	});
});

describe("BotService.analyzeFen through the pool", () => {
	let bot;

	afterEach(() => bot.shutdown());

	const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1";

	it("returns the engine's best move and score", async () => {
		bot = new BotService(new StockfishPool({
			size: 1,
			workerData: { enginePath: process.execPath, engineArgs: [FAKE_ENGINE, "ok"] },
		}));

		await expect(bot.analyzeFen(START_FEN, 16)).resolves.toEqual({ bestMove: "e2e4", scoreCp: 20 });
	});

	it("rejects instead of guessing when no engine is configured", async () => {
		bot = new BotService(new StockfishPool({ size: 1, workerData: { enginePath: null } }));

		await expect(bot.analyzeFen(START_FEN, 16)).rejects.toMatchObject({ code: "ENGINE_UNAVAILABLE" });
	});

	it("queues analysis at background priority", async () => {
		const pool = new StockfishPool({ size: 1, workerData: { enginePath: null } });
		bot = new BotService(pool);
		const run = jest.spyOn(pool, "run");

		await bot.analyzeFen(START_FEN, 12).catch(() => {});

		expect(run).toHaveBeenCalledWith(
			{ kind: "analyze", fen: START_FEN, depth: 12 },
			expect.objectContaining({ priority: PRIORITY.ANALYSIS }),
		);
	});
});
