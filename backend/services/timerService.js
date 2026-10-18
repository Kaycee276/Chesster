/**
 * TimerService
 *
 * Two related-but-distinct pieces of in-memory, per-server-process state
 * live here (same pattern the original shared-countdown timer used):
 *
 *   1. Game clocks — per-player remaining time with Fischer increment,
 *      supporting standard Bullet/Blitz/Rapid presets (feat: clock
 *      increment / time control support).
 *   2. Reconnect grace timers — a 60s countdown started when a player's
 *      socket disconnects, auto-forfeiting the match if they don't
 *      reconnect in time (feat: Socket.io reconnect strategy).
 */

// ---------------------------------------------------------------------------
// Time control presets
// ---------------------------------------------------------------------------

// base = starting seconds per player, increment = Fischer bonus seconds added
// to the mover's clock after each move they make.
const TIME_CONTROLS = {
	bullet: { label: "Bullet (1+0)", baseSeconds: 60, incrementSeconds: 0 },
	bullet2: { label: "Bullet (2+1)", baseSeconds: 120, incrementSeconds: 1 },
	blitz: { label: "Blitz (3+2)", baseSeconds: 180, incrementSeconds: 2 },
	blitz5: { label: "Blitz (5+0)", baseSeconds: 300, incrementSeconds: 0 },
	rapid: { label: "Rapid (10+0)", baseSeconds: 600, incrementSeconds: 0 },
	rapid15: { label: "Rapid (15+10)", baseSeconds: 900, incrementSeconds: 10 },
};

const DEFAULT_PRESET = "rapid";
const RECONNECT_GRACE_SECONDS = 60;

// Heartbeat configuration for detecting dead mobile connections
const HEARTBEAT_INTERVAL_MS = 15 * 1000; // Send ping every 15 seconds
const HEARTBEAT_TIMEOUT_MS = 10 * 1000; // Wait 10 seconds for pong response
const HEARTBEAT_MAX_MISSES = 2; // Disconnect after 2 consecutive missed pongs

function resolveTimeControl({ preset, baseSeconds, incrementSeconds } = {}) {
	if (preset && TIME_CONTROLS[preset]) {
		return { preset, ...TIME_CONTROLS[preset] };
	}
	if (Number.isFinite(baseSeconds) && baseSeconds > 0) {
		return {
			preset: "custom",
			label: "Custom",
			baseSeconds,
			incrementSeconds: Number.isFinite(incrementSeconds) && incrementSeconds >= 0 ? incrementSeconds : 0,
		};
	}
	return { preset: DEFAULT_PRESET, ...TIME_CONTROLS[DEFAULT_PRESET] };
}

const NS_PER_MS = 1_000_000n;

/** Default monotonic clock source: nanoseconds since an arbitrary origin. */
function monotonicNow() {
	return process.hrtime.bigint();
}

class TimerService {
	constructor({ hrNow = monotonicNow } = {}) {
		this.io = null;

		// Monotonic clock source (bigint nanoseconds). Overridable so tests can
		// simulate event-loop stalls deterministically.
		this.hrNow = hrNow;

		// gameCode -> {
		//   whiteMs, blackMs - banked remaining time (for the active player:
		//                      as of turnStartHr)
		//   incrementMs, preset, turn,
		//   turnStartHr      - process.hrtime.bigint() when the active turn
		//                      began (null while paused)
		//   paused,
		//   deadline         - wall-clock flag-fall estimate (informational)
		//   timeout
		// }
		this.clocks = new Map();

		// legacy shared countdown (kept for callers that only pass a flat
		// duration and don't care about per-player clocks / increments)
		this.timers = new Map();

		// `${gameCode}:${color}` -> { timeout, expiresAt }
		this.player_disconnect_timers = new Map();
		this.reconnectTimers = this.player_disconnect_timers;

		// Heartbeat management: `${gameCode}:${socketId}` -> {
		//   color, interval, pendingPing, missCount, lastHeartbeatAt
		// }
		this.heartbeats = new Map();
	}

	init(io) {
		this.io = io;
	}

	// -------------------------------------------------------------------
	// Per-player clocks (Fischer increment / time controls)
	//
	// Remaining time is never accumulated tick by tick. Each turn records a
	// monotonic anchor (process.hrtime.bigint()) and the active player's
	// remaining time is derived as
	//   remainingMs = bankedMs - Number((now - turnStartHr) / 1_000_000n)
	// so event-loop congestion, late timers or wall-clock adjustments can
	// never make a clock run fast or slow.
	// -------------------------------------------------------------------

	/** Whole milliseconds elapsed on the active player's clock this turn. */
	_elapsedMs(state) {
		this._ensureMonotonicAnchor(state);
		if (state.paused || state.turnStartHr === null) return 0;
		const elapsedNs = this.hrNow() - state.turnStartHr;
		return elapsedNs > 0n ? Number(elapsedNs / NS_PER_MS) : 0;
	}

	/**
	 * Clock states built outside startClock() (older snapshots, tests) only
	 * carry a wall-clock `deadline`. Convert them to a monotonic anchor once
	 * so every later read uses hrtime.
	 */
	_ensureMonotonicAnchor(state) {
		if (state.paused || typeof state.turnStartHr === "bigint") return;
		if (Number.isFinite(state.deadline)) {
			state[this._keyFor(state.turn)] = Math.max(0, state.deadline - Date.now());
		}
		state.turnStartHr = this.hrNow();
	}

	_keyFor(color) {
		return color === "white" ? "whiteMs" : "blackMs";
	}

	_activeRemainingMs(state) {
		const elapsed = this._elapsedMs(state);
		return Math.max(0, this._remainingMsFor(state, state.turn) - elapsed);
	}

	/**
	 * Start (or restart) a per-player clock for a game.
	 * @param {string} gameCode
	 * @param {object} options - { preset, baseSeconds, incrementSeconds, turn }
	 */
	startClock(gameCode, options = {}) {
		this.clearClock(gameCode);

		const tc = resolveTimeControl(options);
		const baseMs = tc.baseSeconds * 1000;
		const incrementMs = tc.incrementSeconds * 1000;
		const turn = options.turn === "black" ? "black" : "white";

		const state = {
			whiteMs: baseMs,
			blackMs: baseMs,
			incrementMs,
			preset: tc.preset,
			turn,
			turnStartHr: this.hrNow(),
			paused: false,
			deadline: Date.now() + baseMs,
			timeout: null,
		};

		this.clocks.set(gameCode, state);
		this._scheduleFlagFall(gameCode);
		this._emitTimerSync(gameCode);
		return this.getClockState(gameCode);
	}

	/**
	 * Call after a move is applied: stops the mover's clock (adding the
	 * increment), and starts the opponent's clock ticking.
	 *
	 * If the mover's time had already run out when the move arrived (the
	 * flag-fall timer was delayed by a congested event loop), no increment is
	 * granted and the flag falls immediately, exactly as it would have on an
	 * idle server.
	 * @param {string} gameCode
	 * @param {"white"|"black"} moverColor - the color that just moved
	 */
	applyMove(gameCode, moverColor) {
		const state = this.clocks.get(gameCode);
		if (!state) return null;

		const key = this._keyFor(moverColor);
		const elapsed = moverColor === state.turn ? this._elapsedMs(state) : 0;
		const remaining = state[key] - elapsed;

		if (moverColor === state.turn && !state.paused && remaining <= 0) {
			state[key] = 0;
			state.turnStartHr = this.hrNow();
			this._scheduleFlagFall(gameCode, 0);
			return this.getClockState(gameCode);
		}

		state[key] = Math.max(0, remaining) + state.incrementMs;
		state.turn = moverColor === "white" ? "black" : "white";
		state.turnStartHr = state.paused ? null : this.hrNow();

		this._scheduleFlagFall(gameCode);
		this._emitTimerSync(gameCode);
		return this.getClockState(gameCode);
	}

	/**
	 * Freeze both clocks (e.g. an arbiter or server-initiated pause). The
	 * active player's elapsed monotonic slice is banked so that resuming
	 * continues from exactly the same remaining time.
	 */
	pauseClock(gameCode) {
		const state = this.clocks.get(gameCode);
		if (!state) return null;
		if (!state.paused) {
			state[this._keyFor(state.turn)] = this._activeRemainingMs(state);
			state.paused = true;
			state.turnStartHr = null;
			if (state.timeout) clearTimeout(state.timeout);
			state.timeout = null;
			state.deadline = null;
			this._emitTimerSync(gameCode);
		}
		return this.getClockState(gameCode);
	}

	/** Resume a paused clock; the active player's turn re-anchors to now. */
	resumeClock(gameCode) {
		const state = this.clocks.get(gameCode);
		if (!state) return null;
		if (state.paused) {
			state.paused = false;
			state.turnStartHr = this.hrNow();
			this._scheduleFlagFall(gameCode);
			this._emitTimerSync(gameCode);
		}
		return this.getClockState(gameCode);
	}

	_remainingMsFor(state, color) {
		return color === "white" ? state.whiteMs : state.blackMs;
	}

	/** Snapshot of remaining time for both players, accounting for the live tick. */
	getClockState(gameCode) {
		const state = this.clocks.get(gameCode);
		if (!state) return null;

		const activeRemaining = this._activeRemainingMs(state);
		const whiteMs = state.turn === "white" ? activeRemaining : state.whiteMs;
		const blackMs = state.turn === "black" ? activeRemaining : state.blackMs;

		return {
			whiteMs,
			blackMs,
			turn: state.turn,
			preset: state.preset,
			incrementMs: state.incrementMs,
			paused: Boolean(state.paused),
		};
	}

	/**
	 * Get precise remaining clocks for both players, accounting for elapsed time
	 * since the current turn started. This is used for reconnection state rehydration
	 * to ensure zero clock discrepancy when a player rejoins.
	 *
	 * @param {string} gameCode
	 * @returns {object|null} { whiteMs, blackMs, turn } with millisecond precision,
	 *                         or null if no clock is running for this game
	 */
	getPreciseClocks(gameCode) {
		return this.getClockState(gameCode);
	}

	/**
	 * Authoritative clock payload broadcast to the game room on every clock
	 * transition: { whiteTimeMs, blackTimeMs, serverTimestamp }.
	 */
	getTimerSyncPayload(gameCode) {
		const clock = this.getClockState(gameCode);
		if (!clock) return null;
		return {
			gameCode,
			whiteTimeMs: clock.whiteMs,
			blackTimeMs: clock.blackMs,
			turn: clock.turn,
			paused: clock.paused,
			serverTimestamp: Date.now(),
		};
	}

	_emitTimerSync(gameCode, payload = this.getTimerSyncPayload(gameCode)) {
		if (this.io && payload) this.io.to(gameCode).emit("timer_sync", payload);
	}

	_scheduleFlagFall(gameCode, delayMs) {
		const state = this.clocks.get(gameCode);
		if (!state) return;
		if (state.timeout) clearTimeout(state.timeout);
		state.timeout = null;
		if (state.paused) return;

		const remaining = delayMs ?? this._activeRemainingMs(state);
		state.deadline = Date.now() + remaining;

		state.timeout = setTimeout(async () => {
			if (this.clocks.get(gameCode) !== state) return;
			// setTimeout may fire early (ms rounding) or late (congestion). The
			// monotonic clock is the only authority on whether time is up.
			const left = this._activeRemainingMs(state);
			if (left > 0) {
				this._scheduleFlagFall(gameCode, left);
				return;
			}

			const loser = state.turn;
			state[this._keyFor(loser)] = 0;
			const finalSync = this.getTimerSyncPayload(gameCode);
			this.clearClock(gameCode);
			this._emitTimerSync(gameCode, finalSync);
			try {
				const gameModel = require("../models/gameModel");
				const game = await gameModel.endByFlag(gameCode, loser);
				await require("../models/userModel").invalidateProfilesForGame(game);
				if (this.io && game) {
					this.io.to(gameCode).emit("game-update", game);
					this.io.to(gameCode).emit("flag-fall", { gameCode, loser, winner: game.winner });
				}
			} catch (err) {
				console.error(`[TimerService] endByFlag failed for ${gameCode}:`, err.message);
			}
		}, remaining);
	}

	clearClock(gameCode) {
		const state = this.clocks.get(gameCode);
		if (state) {
			if (state.timeout) clearTimeout(state.timeout);
			this.clocks.delete(gameCode);
		}
	}

	getTimeControls() {
		return TIME_CONTROLS;
	}

	// -------------------------------------------------------------------
	// Legacy shared countdown (kept for backwards compatibility)
	// -------------------------------------------------------------------

	/**
	 * @deprecated Prefer startClock() for per-player clocks. Retained so
	 * any existing callers relying on the flat shared countdown keep working.
	 * The interval only polls; remaining time is derived from a monotonic
	 * anchor so bunched or skipped ticks cannot shorten or extend the game.
	 */
	startTimer(gameCode, totalSeconds) {
		this.clearTimer(gameCode);

		const totalMs = Math.max(0, totalSeconds) * 1000;
		const startedHr = this.hrNow();
		const remainingMs = () => Math.max(0, totalMs - Number((this.hrNow() - startedHr) / NS_PER_MS));

		const interval = setInterval(async () => {
			if (remainingMs() > 0) return;

			this.clearTimer(gameCode);
			try {
				const gameModel = require("../models/gameModel");
				const game = await gameModel.endByTime(gameCode);
				await require("../models/userModel").invalidateProfilesForGame(game);
				if (this.io && game) {
					this.io.to(gameCode).emit("game-update", game);
				}
			} catch (err) {
				console.error(`[TimerService] endByTime failed for ${gameCode}:`, err.message);
			}
		}, 1000);

		this.timers.set(gameCode, { interval, remainingMs });
	}

	clearTimer(gameCode) {
		const entry = this.timers.get(gameCode);
		if (entry) {
			clearInterval(entry.interval);
			this.timers.delete(gameCode);
		}
	}

	// -------------------------------------------------------------------
	// Reconnect grace period / presence
	// -------------------------------------------------------------------

	/**
	 * Start a 60s grace countdown after a player's socket disconnects.
	 * If cancelReconnectGrace() isn't called for the same game+color before
	 * it fires, the match is auto-forfeited for that color.
	 * @param {string} gameCode
	 * @param {"white"|"black"} color
	 * @param {number} graceSeconds
	 */
	startReconnectGrace(gameCode, color, graceSeconds = RECONNECT_GRACE_SECONDS) {
		const key = `${gameCode}:${color}`;
		this.cancelReconnectGrace(gameCode, color);

		const timeout = setTimeout(async () => {
			this.player_disconnect_timers.delete(key);
			try {
				const gameModel = require("../models/gameModel");
				const game = await gameModel.forfeitByDisconnect(gameCode, color);
				await require("../models/userModel").invalidateProfilesForGame(game);
				this.clearClock(gameCode);
				if (this.io && game) {
					this.io.to(gameCode).emit("game-update", game);
					this.io.to(gameCode).emit("presence-update", {
						gameCode,
						color,
						status: "offline",
						forfeited: true,
					});
					this.io.to(gameCode).emit("game_over", {
						gameCode,
						winner: game.winner === game.player_white_address ? "white" : "black",
						reason: "abandonment",
					});
				}
			} catch (err) {
				console.error(`[TimerService] auto-forfeit failed for ${gameCode}/${color}:`, err.message);
			}
		}, graceSeconds * 1000);

		this.player_disconnect_timers.set(key, { timeout, expiresAt: Date.now() + graceSeconds * 1000 });
	}

	cancelReconnectGrace(gameCode, color) {
		const key = `${gameCode}:${color}`;
		const entry = this.player_disconnect_timers.get(key);
		if (entry) {
			clearTimeout(entry.timeout);
			this.player_disconnect_timers.delete(key);
			return true;
		}
		return false;
	}

	isPendingForfeit(gameCode, color) {
		return this.player_disconnect_timers.has(`${gameCode}:${color}`);
	}

	// -------------------------------------------------------------------
	// Application-level heartbeat monitoring (detect dead mobile connections)
	// -------------------------------------------------------------------

	/**
	 * Start active heartbeat monitoring for a connected player socket.
	 * Emits ping_heartbeat every 15 seconds; expects pong_heartbeat response.
	 * After 2 consecutive missed pongs, the socket should be forcibly disconnected.
	 *
	 * @param {object} socket - Socket.io socket instance
	 * @param {string} gameCode
	 * @param {"white"|"black"} playerColor
	 */
	startHeartbeat(socket, gameCode, playerColor) {
		const key = `${gameCode}:${socket.id}`;
		this.stopHeartbeat(socket, gameCode); // Clear any existing heartbeat

		const state = {
			color: playerColor,
			gameCode,
			missCount: 0,
			lastHeartbeatAt: Date.now(),
			pendingPing: null,
			interval: null,
		};

		// Emit ping every HEARTBEAT_INTERVAL_MS (15s)
		state.interval = setInterval(() => {
			if (!this.heartbeats.has(key)) return; // Heart stopped

			const clientTimestamp = Date.now();
			state.pendingPing = clientTimestamp;

			// Emit challenge to client; expect pong_heartbeat response within HEARTBEAT_TIMEOUT_MS
			if (this.io && socket && socket.emit) {
				socket.emit("ping_heartbeat", { timestamp: clientTimestamp });
			}

			// Schedule timeout: if no pong response within 10s, increment miss count
			const timeoutHandle = setTimeout(() => {
				const current = this.heartbeats.get(key);
				if (!current) return; // Heartbeat was cancelled

				// Increment consecutive miss counter
				current.missCount++;

				if (current.missCount >= HEARTBEAT_MAX_MISSES) {
					// 2 consecutive misses = treat as dead connection; force disconnect
					this.stopHeartbeat(socket, gameCode);
					if (socket && socket.disconnect) {
						socket.disconnect(true); // true = close transport
					}
				}
			}, HEARTBEAT_TIMEOUT_MS);

			// Store timeout so we can cancel it if pong arrives
			state.pendingTimeout = timeoutHandle;
		}, HEARTBEAT_INTERVAL_MS);

		this.heartbeats.set(key, state);
	}

	/**
	 * Record a successful pong_heartbeat response from the client.
	 * Resets the miss counter and clears any pending timeout.
	 *
	 * @param {object} socket
	 * @param {string} gameCode
	 * @param {object} data - { timestamp } from client pong
	 */
	recordHeartbeatAck(socket, gameCode, data = {}) {
		const key = `${gameCode}:${socket.id}`;
		const state = this.heartbeats.get(key);
		if (!state) return;

		// Clear any pending timeout from the last ping
		if (state.pendingTimeout) {
			clearTimeout(state.pendingTimeout);
			state.pendingTimeout = null;
		}

		// Reset miss counter on successful pong
		state.missCount = 0;
		state.lastHeartbeatAt = Date.now();
		state.pendingPing = null;
	}

	/**
	 * Stop heartbeat monitoring for a player socket.
	 * Called when a player leaves/disconnects.
	 *
	 * @param {object} socket
	 * @param {string} gameCode
	 */
	stopHeartbeat(socket, gameCode) {
		const key = `${gameCode}:${socket.id}`;
		const state = this.heartbeats.get(key);
		if (!state) return;

		if (state.interval) {
			clearInterval(state.interval);
		}
		if (state.pendingTimeout) {
			clearTimeout(state.pendingTimeout);
		}

		this.heartbeats.delete(key);
	}

	/**
	 * Utility: Get heartbeat state for a socket (for testing).
	 * @param {object} socket
	 * @param {string} gameCode
	 * @returns {object|null}
	 */
	getHeartbeatState(socket, gameCode) {
		const key = `${gameCode}:${socket.id}`;
		return this.heartbeats.get(key) || null;
	}
}

module.exports = new TimerService();
module.exports.TimerService = TimerService;
module.exports.TIME_CONTROLS = TIME_CONTROLS;
module.exports.RECONNECT_GRACE_SECONDS = RECONNECT_GRACE_SECONDS;
module.exports.HEARTBEAT_INTERVAL_MS = HEARTBEAT_INTERVAL_MS;
module.exports.HEARTBEAT_TIMEOUT_MS = HEARTBEAT_TIMEOUT_MS;
module.exports.HEARTBEAT_MAX_MISSES = HEARTBEAT_MAX_MISSES;
