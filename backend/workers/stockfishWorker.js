const { parentPort, workerData, isMainThread } = require("worker_threads");
const { spawn } = require("child_process");
const { parseUciMove, toUciMove, pickHeuristicMove } = require("../services/botHeuristics");

/**
 * Stockfish worker thread (Issue #241).
 *
 * Each worker in botService's BotWorkerPool owns one long-lived UCI engine
 * process and answers one move request at a time. Everything CPU-bound
 * about picking a bot move (engine I/O parsing and the heuristic fallback's
 * legal-move enumeration) happens here, off the main event loop.
 *
 * Protocol with the pool:
 *   in:  { type: "task", id, payload: { fen, board, turn, lastMove, skillLevel, depth, moveTimeMs, deadline } }
 *        (`deadline` is an absolute Date.now() timestamp set by the pool)
 *   out: { type: "result", id, result } | { type: "result", id, error: { message, code } }
 *   out: { type: "engine-pid", pid }   (pid of the engine process, null once it is gone)
 */

// If the engine binary cannot be started at all (e.g. not installed), don't
// try to spawn it again on every request; retry after this cooldown.
const ENGINE_RETRY_COOLDOWN_MS = 30000;
// Portion of a task's time budget reserved for the heuristic fallback plus
// messaging, so a hanging engine is killed early enough to still answer.
const FALLBACK_RESERVE_MS = 200;
// Stockfish may overshoot `movetime` slightly; leave headroom for bestmove.
const MOVETIME_HEADROOM_MS = 150;
const MIN_MOVETIME_MS = 50;

function timeoutError(message) {
	const err = new Error(message);
	err.code = "ENGINE_TIMEOUT";
	return err;
}

/**
 * Minimal line-oriented UCI client around a spawned engine process.
 * Stays alive between searches so each move doesn't pay process start-up
 * and `uci` handshake costs.
 */
class UciEngine {
	constructor(command, args = [], { onPid } = {}) {
		this.command = command;
		this.args = args;
		this.onPid = onPid || (() => {});
		this.process = null;
		this.ready = false;
		this.dead = false;
		this.buffer = "";
		this.waiters = new Set();
	}

	_start() {
		if (this.process) return;

		const child = spawn(this.command, this.args, { stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
		this.process = child;

		child.stdout.on("data", (chunk) => this._onData(chunk));
		child.on("error", (err) => this._fail(err));
		child.on("exit", (code, signal) => {
			this._fail(new Error(`Engine exited (code ${code}, signal ${signal})`));
		});
		// Writing to an engine that just died raises EPIPE on stdin; the exit
		// handler above already reports that failure.
		child.stdin.on("error", () => {});

		if (child.pid) this.onPid(child.pid);
	}

	_onData(chunk) {
		this.buffer += chunk.toString();
		const lines = this.buffer.split(/\r?\n/);
		this.buffer = lines.pop();
		for (const raw of lines) {
			const line = raw.trim();
			if (!line) continue;
			for (const waiter of [...this.waiters]) {
				if (waiter.predicate(line)) {
					this._settle(waiter, null, line);
				}
			}
		}
	}

	_settle(waiter, err, line) {
		if (!this.waiters.delete(waiter)) return;
		clearTimeout(waiter.timer);
		if (err) waiter.reject(err);
		else waiter.resolve(line);
	}

	_fail(err) {
		if (this.dead) return;
		this.dead = true;
		this.ready = false;
		for (const waiter of [...this.waiters]) this._settle(waiter, err);
		this.onPid(null);
	}

	send(command) {
		if (this.dead || !this.process) throw new Error("Engine is not running");
		this.process.stdin.write(`${command}\n`);
	}

	waitFor(predicate, timeoutMs, label) {
		if (this.dead) return Promise.reject(new Error("Engine is not running"));
		return new Promise((resolve, reject) => {
			const waiter = { predicate, resolve, reject, timer: null };
			waiter.timer = setTimeout(
				() => this._settle(waiter, timeoutError(`Engine timed out waiting for ${label}`)),
				Math.max(0, timeoutMs),
			);
			this.waiters.add(waiter);
		});
	}

	async _handshake(deadline) {
		this._start();
		if (this.ready) return;
		const handshake = this.waitFor((line) => line === "uciok", deadline - Date.now(), "uciok");
		this.send("uci");
		await handshake;
		this.ready = true;
	}

	/**
	 * Run one search and resolve to the engine's `bestmove` token
	 * (e.g. "e2e4", or "(none)" when the side to move has no legal moves).
	 */
	async search({ fen, skillLevel, depth, moveTimeMs, deadline }) {
		await this._handshake(deadline);

		this.send(`setoption name Skill Level value ${skillLevel}`);
		// Every request is an independent position, so drop the previous
		// game's hash/history before searching.
		this.send("ucinewgame");
		const ready = this.waitFor((line) => line === "readyok", deadline - Date.now(), "readyok");
		this.send("isready");
		await ready;

		const bestMove = this.waitFor((line) => line.startsWith("bestmove"), deadline - Date.now(), "bestmove");
		this.send(`position fen ${fen}`);
		this.send(`go depth ${depth} movetime ${moveTimeMs}`);
		const line = await bestMove;
		return line.split(/\s+/)[1];
	}

	kill() {
		this._fail(new Error("Engine killed"));
		if (this.process) {
			try {
				this.process.stdin.end();
				this.process.kill("SIGKILL");
			} catch (_) { /* already exited */ }
		}
	}
}

/**
 * Build the per-worker move calculator. Exported separately from the
 * thread wiring below so it can be unit tested in-process.
 */
function createMoveHandler({ enginePath, engineArgs = [], onEnginePid } = {}) {
	let engine = null;
	let engineUnavailableUntil = 0;

	async function askEngine(task, deadline) {
		if (!engine || engine.dead) {
			engine = new UciEngine(enginePath, engineArgs, { onPid: onEnginePid });
		}

		const budget = deadline - Date.now();
		const moveTimeMs = Math.max(
			MIN_MOVETIME_MS,
			Math.min(task.moveTimeMs, budget - MOVETIME_HEADROOM_MS),
		);

		return engine.search({
			fen: task.fen,
			skillLevel: task.skillLevel,
			depth: task.depth,
			moveTimeMs,
			deadline,
		});
	}

	async function computeMove(task) {
		const startedAt = Date.now();
		const engineDeadline = task.deadline - FALLBACK_RESERVE_MS;
		let fallbackReason = null;

		if (!enginePath) {
			fallbackReason = "no engine configured";
		} else if (Date.now() < engineUnavailableUntil) {
			fallbackReason = "engine unavailable";
		} else {
			try {
				const uci = await askEngine(task, engineDeadline);
				if (uci === "(none)") {
					return { move: null, uci: null, engine: "stockfish", elapsedMs: Date.now() - startedAt };
				}
				const move = parseUciMove(uci);
				if (move) {
					return { move, uci, engine: "stockfish", elapsedMs: Date.now() - startedAt };
				}
				fallbackReason = `unparseable engine move "${uci}"`;
			} catch (err) {
				fallbackReason = err.message;
				// A hung or broken engine is killed and lazily re-spawned on
				// the next request; a missing binary is not retried for a while.
				if (engine) engine.kill();
				engine = null;
				if (err.code === "ENOENT" || err.code === "EACCES") {
					engineUnavailableUntil = Date.now() + ENGINE_RETRY_COOLDOWN_MS;
				}
			}
		}

		const heuristic = pickHeuristicMove(task.board, task.turn, task.lastMove || null, task.skillLevel);
		if (!heuristic) {
			return { move: null, uci: null, engine: "heuristic", fallbackReason, elapsedMs: Date.now() - startedAt };
		}
		return {
			move: heuristic,
			uci: toUciMove(heuristic),
			engine: "heuristic",
			fallbackReason,
			elapsedMs: Date.now() - startedAt,
		};
	}

	function dispose() {
		if (engine) engine.kill();
		engine = null;
	}

	return { computeMove, dispose };
}

if (!isMainThread && parentPort) {
	const handler = createMoveHandler({
		enginePath: workerData && workerData.enginePath,
		engineArgs: (workerData && workerData.engineArgs) || [],
		onEnginePid: (pid) => parentPort.postMessage({ type: "engine-pid", pid }),
	});

	parentPort.on("message", async (message) => {
		if (!message || message.type !== "task") return;
		try {
			const result = await handler.computeMove(message.payload);
			parentPort.postMessage({ type: "result", id: message.id, result });
		} catch (err) {
			parentPort.postMessage({ type: "result", id: message.id, error: { message: err.message, code: err.code } });
		}
	});

	parentPort.on("close", () => handler.dispose());
}

module.exports = { UciEngine, createMoveHandler, ENGINE_RETRY_COOLDOWN_MS };
