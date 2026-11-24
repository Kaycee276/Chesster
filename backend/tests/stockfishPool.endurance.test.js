const path = require("path");
const { StockfishPool } = require("../services/stockfishPool");

// Scriptable worker from the fixtures directory. "crash" exits the worker thread,
// "hang" starts a child process that never answers, and "spin"/default answer immediately.
const TEST_WORKER = path.join(__dirname, "fixtures", "poolTestWorker.js");

const EVALUATION_COUNT = 500;
const WARMUP_COUNT = 50;
const MAX_HEAP_GROWTH_BYTES = 15 * 1024 * 1024;

function isAlive(pid) {
	try {
		process.kill(pid, 0);
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

describe("StockfishPool endurance and fault tolerance (Issue #664)", () => {
	let pool;
	// Every engine child process seen during the suite. All must be gone at the end.
	const engineChildPids = new Set();

	function trackEngine() {
		const pid = pool.workers.length ? pool.workers[0].enginePid : null;
		if (pid) engineChildPids.add(pid);
		return pid;
	}

	afterEach(async () => {
		if (pool) await pool.destroy();
		pool = null;
	});

	afterAll(async () => {
		for (const pid of engineChildPids) {
			expect(await waitFor(() => !isAlive(pid))).toBe(true);
		}
	});

	describe("worker crash and respawn", () => {
		it("fails the task that was running when its worker died, then respawns and serves the next task", async () => {
			pool = new StockfishPool({ size: 1, workerScript: TEST_WORKER, taskTimeoutMs: 10000 });
			pool.warmup();
			const before = await pool.executeMove({ label: "before" });

			await expect(pool.executeMove({ mode: "crash" })).rejects.toMatchObject({ code: "BOT_WORKER_EXITED" });

			// The replacement worker is spawned synchronously, so the pool is back at full size.
			expect(pool.stats()).toMatchObject({ size: 1, workers: 1, busy: 0 });

			const after = await pool.executeMove({ label: "after" });
			expect(after.label).toBe("after");
			expect(after.threadId).not.toBe(before.threadId);
		});

		it("keeps draining the queue after a crash, so queued tasks are not stranded", async () => {
			pool = new StockfishPool({ size: 1, workerScript: TEST_WORKER, taskTimeoutMs: 10000 });
			pool.warmup();

			const crashed = pool.executeMove({ mode: "crash" });
			const queued = [1, 2, 3].map((label) => pool.executeMove({ label }));

			await expect(crashed).rejects.toMatchObject({ code: "BOT_WORKER_EXITED" });
			const results = await Promise.all(queued);

			expect(results.map((r) => r.label)).toEqual([1, 2, 3]);
			expect(pool.stats()).toMatchObject({ workers: 1, busy: 0, queued: 0 });
		});
	});

	describe("command timeout and recovery", () => {
		it("times out a hung engine and keeps serving the queue behind it", async () => {
			pool = new StockfishPool({ size: 1, workerScript: TEST_WORKER, taskTimeoutMs: 10000 });
			// Boot the worker first so its start-up time does not use up the hang timeout.
			await pool.executeMove({ label: "warm" });

			// Attach the rejection handler now so the timeout never fires into an unhandled promise.
			const hungRejected = expect(pool.run({ mode: "hang" }, { timeoutMs: 300 }))
				.rejects.toMatchObject({ code: "BOT_TIMEOUT" });
			const queued = pool.executeMove({ label: "queued" });

			expect(await waitFor(() => trackEngine())).toBeTruthy();
			const hungEngine = trackEngine();

			await hungRejected;
			await expect(queued).resolves.toMatchObject({ label: "queued" });

			expect(pool.stats()).toMatchObject({ workers: 1, busy: 0, queued: 0 });
			expect(await waitFor(() => !isAlive(hungEngine))).toBe(true);
		});

		it("accepts new work immediately after a timed-out command without deadlocking", async () => {
			pool = new StockfishPool({ size: 1, workerScript: TEST_WORKER, taskTimeoutMs: 10000 });
			await pool.executeMove({ label: "warm" });

			for (let round = 0; round < 3; round += 1) {
				const hungRejected = expect(pool.run({ mode: "hang" }, { timeoutMs: 1000 }))
					.rejects.toMatchObject({ code: "BOT_TIMEOUT" });
				// Record the engine pid before the timeout replaces the worker that owns it.
				expect(await waitFor(() => trackEngine())).toBeTruthy();
				await hungRejected;
				await expect(pool.executeMove({ label: round })).resolves.toMatchObject({ label: round });
			}

			expect(pool.stats()).toMatchObject({ workers: 1, busy: 0, queued: 0 });
		});
	});

	describe("memory endurance", () => {
		it(`keeps heap growth under 15MB across ${EVALUATION_COUNT} sequential evaluations`, async () => {
			pool = new StockfishPool({ size: 1, workerScript: TEST_WORKER, taskTimeoutMs: 10000 });
			pool.warmup();

			// Warm up module caches and JIT so the baseline reflects steady state.
			for (let i = 0; i < WARMUP_COUNT; i += 1) {
				await pool.executeMove({ label: i });
			}
			if (global.gc) global.gc();
			const baseline = process.memoryUsage().heapUsed;

			let completed = 0;
			for (let i = 0; i < EVALUATION_COUNT; i += 1) {
				const result = await pool.executeMove({ label: i });
				if (result.label === i) completed += 1;
			}

			if (global.gc) global.gc();
			const growth = process.memoryUsage().heapUsed - baseline;

			expect(completed).toBe(EVALUATION_COUNT);
			expect(growth).toBeLessThan(MAX_HEAP_GROWTH_BYTES);
			// No task, timer or queue entry should outlive its evaluation.
			expect(pool.stats()).toMatchObject({ workers: 1, busy: 0, queued: 0 });
			expect(pool.queue).toHaveLength(0);
		}, 60000);
	});

	describe("teardown", () => {
		it("leaves no workers or queued tasks after destroy, even with work in flight", async () => {
			pool = new StockfishPool({ size: 1, workerScript: TEST_WORKER, queueTimeoutMs: 60000 });

			const hungRejected = expect(pool.executeMove({ mode: "hang" }))
				.rejects.toMatchObject({ code: "BOT_POOL_CLOSED" });
			const queuedRejected = expect(pool.executeMove({ label: "queued" }))
				.rejects.toMatchObject({ code: "BOT_POOL_CLOSED" });
			expect(await waitFor(() => trackEngine())).toBeTruthy();
			const hungEngine = trackEngine();

			await pool.destroy();

			await hungRejected;
			await queuedRejected;
			expect(pool.stats()).toMatchObject({ workers: 0, queued: 0 });
			expect(await waitFor(() => !isAlive(hungEngine))).toBe(true);
			pool = null;
		});
	});
});
