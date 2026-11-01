const os = require("os");
const path = require("path");
const { Worker } = require("worker_threads");

// Hard ceiling for a single engine task, including engine start-up. A worker
// that hasn't answered by then is terminated (along with its engine) and
// replaced, so a hanging engine query can never pile up requests.
const BOT_MOVE_TIMEOUT_MS = parseInt(process.env.BOT_MOVE_TIMEOUT_MS || "3000", 10);
// Requests waiting for a free worker beyond this are rejected (HTTP 503)
// instead of queueing unbounded work behind a saturated pool.
const BOT_MAX_QUEUE_SIZE = parseInt(process.env.BOT_MAX_QUEUE_SIZE || "100", 10);
// A queued task that cannot start within this window is stale and is rejected
// with BOT_TIMEOUT instead of running long after its caller stopped caring.
const BOT_QUEUE_TIMEOUT_MS = parseInt(process.env.BOT_QUEUE_TIMEOUT_MS || "10000", 10);

// After this many worker crashes in a row (e.g. a broken worker script) the
// pool stops respawning and fails queued work instead of crash-looping.
const MAX_CONSECUTIVE_CRASHES = 5;

const WORKER_SCRIPT = path.join(__dirname, "..", "workers", "stockfishWorker.js");

/** Lower value runs first. Live match moves always beat background analysis. */
const PRIORITY = Object.freeze({ MOVE: 0, ANALYSIS: 1 });

function cpuCount() {
	return typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
}

/** Default pool size: up to 4 workers, leaving one core for the main event loop. */
function defaultPoolSize() {
	return Math.max(1, Math.min(4, cpuCount() - 1));
}

/** Concurrency from BOT_MAX_CONCURRENCY (or the older BOT_WORKER_POOL_SIZE). */
function configuredPoolSize(env = process.env) {
	return parseInt(env.BOT_MAX_CONCURRENCY || env.BOT_WORKER_POOL_SIZE || "", 10) || defaultPoolSize();
}

function botError(message, code) {
	const err = new Error(message);
	err.code = code;
	return err;
}

/**
 * Fixed-size pool of worker threads running backend/workers/stockfishWorker.js
 * (Issues #241, #437). Each worker owns one long-lived UCI engine process, so
 * at most `size` engine searches run at once no matter how many requests
 * arrive. Tasks are queued by priority (FIFO within a priority) and
 * dispatched to idle workers, keeping engine work off the main event loop.
 *
 * Workers are spawned lazily on first use and are unref'd while idle, so an
 * unused pool costs nothing and never keeps the process alive.
 */
class StockfishPool {
	constructor({
		size = defaultPoolSize(),
		workerScript = WORKER_SCRIPT,
		workerData = {},
		taskTimeoutMs = BOT_MOVE_TIMEOUT_MS,
		maxQueueSize = BOT_MAX_QUEUE_SIZE,
		queueTimeoutMs = BOT_QUEUE_TIMEOUT_MS,
	} = {}) {
		// Never run more engine threads than there are cores to run them.
		this.size = Math.max(1, Math.min(Math.floor(size) || 1, cpuCount()));
		// Background work may never occupy every engine: one stays free for live moves.
		this.maxBackgroundWorkers = Math.max(1, this.size - 1);
		this.workerScript = workerScript;
		this.workerData = workerData;
		this.taskTimeoutMs = taskTimeoutMs;
		this.maxQueueSize = maxQueueSize;
		this.queueTimeoutMs = queueTimeoutMs;

		this.workers = [];
		this.queue = [];
		this.nextTaskId = 1;
		this.consecutiveCrashes = 0;
		this.destroyed = false;
	}

	/** Spawn every worker up front instead of on the first request. */
	warmup() {
		this._ensureWorkers();
	}

	/**
	 * Queue a live-move calculation at the highest priority.
	 * @param {object} payload - { fen, board, turn, lastMove, skillLevel, depth, moveTimeMs }
	 * @returns {Promise<{ move, uci, engine, fallbackReason?, elapsedMs }>}
	 */
	executeMove(payload, options = {}) {
		return this.run(payload, { priority: PRIORITY.MOVE, ...options });
	}

	/**
	 * Queue any worker task.
	 * @param {object} payload - forwarded to the worker with an absolute `deadline` added
	 * @param {{ priority?: number, timeoutMs?: number, queueTimeoutMs?: number }} [options]
	 */
	run(payload, { priority = PRIORITY.MOVE, timeoutMs = this.taskTimeoutMs, queueTimeoutMs = this.queueTimeoutMs } = {}) {
		return new Promise((resolve, reject) => {
			if (this.destroyed) {
				return reject(botError("Bot worker pool has been shut down", "BOT_POOL_CLOSED"));
			}
			if (this.queue.length >= this.maxQueueSize && !this._evictLowerPriority(priority)) {
				return reject(botError("Bot engine is busy, please retry shortly", "BOT_QUEUE_FULL"));
			}

			const task = { id: this.nextTaskId++, payload, priority, timeoutMs, resolve, reject, timer: null, queueTimer: null };
			if (queueTimeoutMs > 0) {
				task.queueTimer = setTimeout(() => {
					this._removeQueued(task);
					reject(botError(`Bot task waited more than ${queueTimeoutMs}ms for a free engine`, "BOT_TIMEOUT"));
				}, queueTimeoutMs);
			}
			this._enqueue(task);
			this._ensureWorkers();
			this._drain();
		});
	}

	stats() {
		const busy = this.workers.filter((slot) => slot.task).length;
		return { size: this.size, workers: this.workers.length, busy, idle: this.workers.length - busy, queued: this.queue.length };
	}

	/** Reject all pending work and terminate every worker (and its engine). */
	async destroy() {
		this.destroyed = true;
		const closed = botError("Bot worker pool has been shut down", "BOT_POOL_CLOSED");
		for (const task of this.queue.splice(0)) {
			clearTimeout(task.queueTimer);
			task.reject(closed);
		}
		await Promise.all([...this.workers].map((slot) => this._retire(slot, closed)));
	}

	_enqueue(task) {
		const index = this.queue.findIndex((queued) => queued.priority > task.priority);
		if (index === -1) this.queue.push(task);
		else this.queue.splice(index, 0, task);
	}

	_removeQueued(task) {
		const index = this.queue.indexOf(task);
		if (index !== -1) this.queue.splice(index, 1);
	}

	/** Make room for a more urgent task by dropping the least urgent queued one. */
	_evictLowerPriority(priority) {
		const last = this.queue[this.queue.length - 1];
		if (!last || last.priority <= priority) return false;
		this.queue.pop();
		clearTimeout(last.queueTimer);
		last.reject(botError("Bot engine is busy, please retry shortly", "BOT_QUEUE_FULL"));
		return true;
	}

	_ensureWorkers() {
		while (!this.destroyed && this.workers.length < this.size) {
			this._spawnWorker();
		}
	}

	_spawnWorker() {
		const worker = new Worker(this.workerScript, { workerData: this.workerData });
		const slot = { worker, task: null, enginePid: null, retired: false };

		worker.on("message", (message) => this._onMessage(slot, message));
		worker.on("error", (err) => this._replace(slot, err));
		worker.on("exit", (code) => {
			this._replace(slot, botError(`Bot worker exited unexpectedly (code ${code})`, "BOT_WORKER_EXITED"));
		});
		// Must come after the listeners: adding a "message" listener re-refs.
		worker.unref();

		this.workers.push(slot);
		return slot;
	}

	_drain() {
		for (const slot of this.workers) {
			if (this.queue.length === 0) return;
			if (slot.task || slot.retired) continue;
			// The queue is priority-sorted, so a blocked background head means nothing else can run.
			if (this.queue[0].priority > PRIORITY.MOVE && this._busyBackground() >= this.maxBackgroundWorkers) return;
			this._dispatch(slot, this.queue.shift());
		}
	}

	_busyBackground() {
		return this.workers.filter((slot) => slot.task && slot.task.priority > PRIORITY.MOVE).length;
	}

	_dispatch(slot, task) {
		clearTimeout(task.queueTimer);
		slot.task = task;
		slot.worker.ref();
		task.timer = setTimeout(() => {
			this._replace(slot, botError(`Bot move exceeded ${task.timeoutMs}ms`, "BOT_TIMEOUT"));
		}, task.timeoutMs);

		slot.worker.postMessage({
			type: "task",
			id: task.id,
			payload: { ...task.payload, deadline: Date.now() + task.timeoutMs },
		});
	}

	_onMessage(slot, message) {
		if (!message) return;
		if (message.type === "engine-pid") {
			slot.enginePid = message.pid || null;
			return;
		}
		if (message.type !== "result" || !slot.task || slot.task.id !== message.id) return;

		const task = slot.task;
		this._release(slot);
		this.consecutiveCrashes = 0;
		if (message.error) {
			task.reject(botError(message.error.message, message.error.code || "BOT_WORKER_ERROR"));
		} else {
			task.resolve(message.result);
		}
		this._drain();
	}

	_release(slot) {
		clearTimeout(slot.task.timer);
		slot.task = null;
		slot.worker.unref();
	}

	/** Tear a worker down, failing its in-flight task, and start a fresh one. */
	_replace(slot, err) {
		if (slot.retired) return;
		this._retire(slot, err);

		if (err.code !== "BOT_TIMEOUT") this.consecutiveCrashes += 1;
		if (this.consecutiveCrashes >= MAX_CONSECUTIVE_CRASHES) {
			// Stop the crash loop; the next run() tries fresh workers.
			this.consecutiveCrashes = 0;
			if (this.workers.length === 0) {
				for (const task of this.queue.splice(0)) {
					clearTimeout(task.queueTimer);
					task.reject(err);
				}
			}
			return;
		}

		this._ensureWorkers();
		this._drain();
	}

	_retire(slot, err) {
		if (slot.retired) return Promise.resolve();
		slot.retired = true;
		this.workers = this.workers.filter((s) => s !== slot);

		if (slot.task) {
			const task = slot.task;
			this._release(slot);
			task.reject(err);
		}

		// The engine is a child process of this Node process, not of the
		// worker thread, so terminating the worker alone would orphan it.
		if (slot.enginePid) {
			try {
				process.kill(slot.enginePid, "SIGKILL");
			} catch (_) { /* already gone */ }
			slot.enginePid = null;
		}

		slot.worker.removeAllListeners();
		slot.worker.on("error", () => {});
		return slot.worker.terminate().catch(() => {});
	}
}

module.exports = {
	StockfishPool,
	PRIORITY,
	configuredPoolSize,
	defaultPoolSize,
	BOT_MOVE_TIMEOUT_MS,
};
