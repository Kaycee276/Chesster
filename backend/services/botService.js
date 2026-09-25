const os = require("os");
const path = require("path");
const { Worker } = require("worker_threads");
const { parseUciMove, getLegalMoves } = require("./botHeuristics");

// Path to a UCI-speaking Stockfish binary. Not bundled with this repo (the
// official `stockfish` npm package ships 100MB+ of prebuilt WASM binaries
// per platform, which is heavy for this project) — instead we shell out to
// whatever engine is available on the host, same as most self-hosted chess
// servers do. Set STOCKFISH_PATH to point at a real Stockfish executable in
// any environment where bots should actually play at engine strength.
const STOCKFISH_PATH = process.env.STOCKFISH_PATH || "stockfish";
const ENGINE_MOVE_TIME_MS = parseInt(process.env.STOCKFISH_MOVE_TIME_MS || "800", 10);

// Hard ceiling for a single bot move, including engine start-up. A worker
// that hasn't answered by then is terminated (along with its engine) and
// replaced, so a hanging engine query can never pile up requests.
const BOT_MOVE_TIMEOUT_MS = parseInt(process.env.BOT_MOVE_TIMEOUT_MS || "3000", 10);
// Requests waiting for a free worker beyond this are rejected (HTTP 503)
// instead of queueing unbounded work behind a saturated pool.
const BOT_MAX_QUEUE_SIZE = parseInt(process.env.BOT_MAX_QUEUE_SIZE || "100", 10);

// After this many worker crashes in a row (e.g. a broken worker script) the
// pool stops respawning and fails queued work instead of crash-looping.
const MAX_CONSECUTIVE_CRASHES = 5;

const WORKER_SCRIPT = path.join(__dirname, "..", "workers", "stockfishWorker.js");

function cpuCount() {
	return typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
}

/** Default pool size: up to 4 workers, leaving one core for the main event loop. */
function defaultPoolSize() {
	return Math.max(1, Math.min(4, cpuCount() - 1));
}

// Expected, steady-state fallback reasons that shouldn't be logged per move.
const QUIET_FALLBACK_REASONS = new Set(["engine unavailable", "no engine configured"]);

/**
 * Difficulty presets -> UCI "Skill Level" (0-20) and search depth.
 * Beginner / Intermediate / Master are the single-player bot tiers; the
 * older easy/medium/hard/maximum names are kept for existing clients.
 */
const DIFFICULTY_PRESETS = {
	beginner: { skillLevel: 1, depth: 3 },
	easy: { skillLevel: 2, depth: 5 },
	intermediate: { skillLevel: 8, depth: 8 },
	medium: { skillLevel: 10, depth: 10 },
	hard: { skillLevel: 18, depth: 16 },
	master: { skillLevel: 20, depth: 20 },
	maximum: { skillLevel: 20, depth: 22 },
};

/** Map a 0-20 skill level onto a search depth consistent with the presets. */
function depthForSkill(skillLevel) {
	return Math.max(1, Math.min(22, Math.round(3 + skillLevel * 0.9)));
}

/**
 * Resolve a difficulty (preset name, case-insensitive, or 0-20 skill level)
 * into the engine parameters used for the search.
 * @returns {{ skillLevel: number, depth: number }}
 */
function resolveDifficulty(difficulty) {
	if (typeof difficulty === "number" && Number.isFinite(difficulty)) {
		const skillLevel = Math.max(0, Math.min(20, Math.round(difficulty)));
		return { skillLevel, depth: depthForSkill(skillLevel) };
	}
	if (typeof difficulty === "string") {
		const preset = DIFFICULTY_PRESETS[difficulty.trim().toLowerCase()];
		if (preset) return { ...preset };
	}
	return { ...DIFFICULTY_PRESETS.medium };
}

function resolveSkillLevel(difficulty) {
	return resolveDifficulty(difficulty).skillLevel;
}

/**
 * Convert this project's 8x8 char-array board (row 0 = rank 8, matching
 * chessEngine.initBoard()) into a FEN position string.
 *
 * Castling rights and en-passant target aren't tracked by chessEngine, so
 * they're conservatively reported as unavailable ("-"). This slightly
 * under-informs the engine (it won't consider castling/en-passant replies)
 * but never produces an illegal position.
 */
function boardToFEN(board, turn, moveCount = 0) {
	const rows = board.map((row) => {
		let fenRow = "";
		let empty = 0;
		for (const cell of row) {
			if (cell === ".") {
				empty += 1;
			} else {
				if (empty > 0) {
					fenRow += empty;
					empty = 0;
				}
				fenRow += cell;
			}
		}
		if (empty > 0) fenRow += empty;
		return fenRow;
	});

	const placement = rows.join("/");
	const active = turn === "black" ? "b" : "w";
	const fullmove = Math.max(1, Math.floor(moveCount / 2) + 1);

	return `${placement} ${active} - - 0 ${fullmove}`;
}

function botError(message, code) {
	const err = new Error(message);
	err.code = code;
	return err;
}

/**
 * Fixed-size pool of worker threads running backend/workers/stockfishWorker.js
 * (Issue #241). Move requests are queued FIFO and dispatched to idle workers,
 * so engine searches never run on the main HTTP/WebSocket event loop.
 *
 * Workers are spawned lazily on first use and are unref'd while idle, so an
 * unused pool costs nothing and never keeps the process alive.
 */
class BotWorkerPool {
	constructor({
		size = defaultPoolSize(),
		workerScript = WORKER_SCRIPT,
		workerData = {},
		taskTimeoutMs = BOT_MOVE_TIMEOUT_MS,
		maxQueueSize = BOT_MAX_QUEUE_SIZE,
	} = {}) {
		// Never run more engine threads than there are cores to run them.
		this.size = Math.max(1, Math.min(Math.floor(size) || 1, cpuCount()));
		this.workerScript = workerScript;
		this.workerData = workerData;
		this.taskTimeoutMs = taskTimeoutMs;
		this.maxQueueSize = maxQueueSize;

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
	 * Queue a move calculation.
	 * @param {object} payload - { fen, board, turn, lastMove, skillLevel, depth, moveTimeMs }
	 * @returns {Promise<{ move, uci, engine, fallbackReason?, elapsedMs }>}
	 */
	executeMove(payload) {
		return new Promise((resolve, reject) => {
			if (this.destroyed) {
				return reject(botError("Bot worker pool has been shut down", "BOT_POOL_CLOSED"));
			}
			if (this.queue.length >= this.maxQueueSize) {
				return reject(botError("Bot engine is busy, please retry shortly", "BOT_QUEUE_FULL"));
			}

			this.queue.push({ id: this.nextTaskId++, payload, resolve, reject, timer: null });
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
		for (const task of this.queue.splice(0)) task.reject(closed);
		await Promise.all([...this.workers].map((slot) => this._retire(slot, closed)));
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
			if (!slot.task && !slot.retired) this._dispatch(slot, this.queue.shift());
		}
	}

	_dispatch(slot, task) {
		slot.task = task;
		slot.worker.ref();
		task.timer = setTimeout(() => {
			this._replace(slot, botError(`Bot move exceeded ${this.taskTimeoutMs}ms`, "BOT_TIMEOUT"));
		}, this.taskTimeoutMs);

		slot.worker.postMessage({
			type: "task",
			id: task.id,
			payload: { ...task.payload, deadline: Date.now() + this.taskTimeoutMs },
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
			// Stop the crash loop; the next executeMove() tries fresh workers.
			this.consecutiveCrashes = 0;
			if (this.workers.length === 0) {
				for (const task of this.queue.splice(0)) task.reject(err);
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

class BotService {
	constructor(pool) {
		this._pool = pool || null;
	}

	/** The shared worker pool, created on first use. */
	get pool() {
		if (!this._pool) {
			this._pool = new BotWorkerPool({
				size: parseInt(process.env.BOT_WORKER_POOL_SIZE || "", 10) || defaultPoolSize(),
				workerData: { enginePath: STOCKFISH_PATH },
			});
		}
		return this._pool;
	}

	/**
	 * Compute the bot's move for a single-player game. The search runs in a
	 * pooled worker thread (Stockfish when available, otherwise a heuristic
	 * picker) and is capped at BOT_MOVE_TIMEOUT_MS.
	 * @param {string[][]} board - internal board representation
	 * @param {"white"|"black"} turn - color the bot is playing
	 * @param {object|null} lastMove - { from, to, piece } of the last move (for en passant)
	 * @param {string|number} difficulty - "beginner"|"intermediate"|"master" (or legacy
	 *   "easy"|"medium"|"hard"|"maximum"), or a 0-20 skill level
	 * @param {number} moveCount
	 * @returns {Promise<{ from:number[], to:number[], promotion:string|null, uci:string,
	 *   engine:"stockfish"|"heuristic", skillLevel:number, depth:number }|null>}
	 * @throws {Error} with code BOT_TIMEOUT or BOT_QUEUE_FULL when the pool can't answer in time
	 */
	async getBestMove(board, turn, lastMove = null, difficulty = "medium", moveCount = 0) {
		const { skillLevel, depth } = resolveDifficulty(difficulty);
		const fen = boardToFEN(board, turn, moveCount);

		const result = await this.pool.executeMove({
			fen,
			board,
			turn,
			lastMove,
			skillLevel,
			depth,
			moveTimeMs: ENGINE_MOVE_TIME_MS,
		});

		if (result.fallbackReason && !QUIET_FALLBACK_REASONS.has(result.fallbackReason)) {
			console.warn(`[BotService] Stockfish unavailable (${result.fallbackReason}), falling back to heuristic engine`);
		}

		if (!result.move) return null;
		return { ...result.move, uci: result.uci, engine: result.engine, skillLevel, depth };
	}

	/** Terminate the worker pool (graceful shutdown / tests). */
	async shutdown() {
		if (this._pool) {
			const pool = this._pool;
			this._pool = null;
			await pool.destroy();
		}
	}
}

module.exports = new BotService();
module.exports.BotService = BotService;
module.exports.BotWorkerPool = BotWorkerPool;
module.exports.DIFFICULTY_PRESETS = DIFFICULTY_PRESETS;
module.exports.boardToFEN = boardToFEN;
module.exports.parseUciMove = parseUciMove;
module.exports.getLegalMoves = getLegalMoves;
module.exports.resolveDifficulty = resolveDifficulty;
module.exports.resolveSkillLevel = resolveSkillLevel;
