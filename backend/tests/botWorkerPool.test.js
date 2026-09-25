const os = require("os");
const path = require("path");
const { threadId: mainThreadId } = require("worker_threads");
const { BotWorkerPool } = require("../services/botService");

const TEST_WORKER = path.join(__dirname, "fixtures", "poolTestWorker.js");
const BROKEN_WORKER = path.join(__dirname, "fixtures", "brokenWorker.js");
const cores = typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;

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

describe("BotWorkerPool", () => {
	let pool;

	afterEach(async () => {
		if (pool) await pool.destroy();
		pool = null;
	});

	it("caps the pool size at the CPU core count", () => {
		pool = new BotWorkerPool({ size: cores + 8, workerScript: TEST_WORKER });
		expect(pool.size).toBe(cores);
	});

	it("does not spawn workers until the first move is requested", () => {
		pool = new BotWorkerPool({ size: 2, workerScript: TEST_WORKER });
		expect(pool.stats().workers).toBe(0);
	});

	it("runs move calculations off the main thread with an absolute deadline", async () => {
		pool = new BotWorkerPool({ size: 1, workerScript: TEST_WORKER, taskTimeoutMs: 2000 });

		const before = Date.now();
		const result = await pool.executeMove({ label: "a" });

		expect(result.threadId).not.toBe(mainThreadId);
		expect(result.label).toBe("a");
		expect(result.deadline).toBeGreaterThanOrEqual(before + 2000);
		expect(result.deadline).toBeLessThanOrEqual(Date.now() + 2000);
	});

	it("dispatches up to `size` tasks at once and queues the rest in order", async () => {
		pool = new BotWorkerPool({ size: 1, workerScript: TEST_WORKER });

		const order = [];
		const tasks = ["a", "b", "c"].map((label) =>
			pool.executeMove({ mode: "spin", ms: 30, label }).then((r) => order.push(r.label)),
		);

		expect(pool.stats()).toMatchObject({ busy: 1, queued: 2 });
		await Promise.all(tasks);
		expect(order).toEqual(["a", "b", "c"]);
		expect(pool.stats()).toMatchObject({ busy: 0, queued: 0 });
	});

	it("rejects new work with BOT_QUEUE_FULL once the queue is full", async () => {
		pool = new BotWorkerPool({ size: 1, workerScript: TEST_WORKER, maxQueueSize: 1 });

		const running = pool.executeMove({ mode: "spin", ms: 50 });
		const queued = pool.executeMove({ mode: "spin", ms: 1 });

		await expect(pool.executeMove({})).rejects.toMatchObject({ code: "BOT_QUEUE_FULL" });
		await Promise.all([running, queued]);
	});

	it("times out a hanging query, kills its engine process and replaces the worker", async () => {
		pool = new BotWorkerPool({ size: 1, workerScript: TEST_WORKER, taskTimeoutMs: 300 });

		const hung = pool.executeMove({ mode: "hang" });
		expect(await waitFor(() => pool.workers[0] && pool.workers[0].enginePid)).toBeTruthy();
		const enginePid = pool.workers[0].enginePid;

		const startedAt = Date.now();
		await expect(hung).rejects.toMatchObject({ code: "BOT_TIMEOUT" });
		expect(Date.now() - startedAt).toBeLessThan(1000);

		expect(await waitFor(() => !isAlive(enginePid))).toBe(true);

		const next = await pool.executeMove({ label: "after-timeout" });
		expect(next.label).toBe("after-timeout");
	});

	it("fails the in-flight task when a worker crashes and keeps serving", async () => {
		pool = new BotWorkerPool({ size: 1, workerScript: TEST_WORKER });

		await expect(pool.executeMove({ mode: "crash" })).rejects.toMatchObject({ code: "BOT_WORKER_EXITED" });
		const next = await pool.executeMove({ label: "after-crash" });
		expect(next.label).toBe("after-crash");
	});

	it("propagates worker-reported errors", async () => {
		pool = new BotWorkerPool({ size: 1, workerScript: TEST_WORKER });

		await expect(pool.executeMove({ mode: "error" })).rejects.toMatchObject({
			message: "engine blew up",
			code: "ENGINE_FAIL",
		});
	});

	it("stops respawning a worker script that crashes on every load", async () => {
		pool = new BotWorkerPool({ size: 1, workerScript: BROKEN_WORKER });

		// The in-flight task fails with the first crash; the pool then gives up
		// respawning after a handful of consecutive failures.
		await expect(pool.executeMove({})).rejects.toThrow(/worker failed to load/);
		expect(await waitFor(() => pool.stats().workers === 0)).toBe(true);
		await new Promise((resolve) => setTimeout(resolve, 300));
		expect(pool.stats().workers).toBe(0);
	});

	it("rejects queued and new work after destroy()", async () => {
		pool = new BotWorkerPool({ size: 1, workerScript: TEST_WORKER });

		const running = expect(pool.executeMove({ mode: "spin", ms: 200 })).rejects.toMatchObject({ code: "BOT_POOL_CLOSED" });
		const queued = expect(pool.executeMove({})).rejects.toMatchObject({ code: "BOT_POOL_CLOSED" });
		await pool.destroy();

		await running;
		await queued;
		await expect(pool.executeMove({})).rejects.toMatchObject({ code: "BOT_POOL_CLOSED" });
	});
});
