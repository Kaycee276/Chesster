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

class TimerService {
	constructor() {
		this.io = null;

		// gameCode -> { whiteMs, blackMs, incrementMs, turn, deadline, timeout }
		this.clocks = new Map();

		// legacy shared countdown (kept for callers that only pass a flat
		// duration and don't care about per-player clocks / increments)
		this.timers = new Map();

		// `${gameCode}:${color}` -> { timeout, expiresAt }
		this.reconnectTimers = new Map();
	}

	init(io) {
		this.io = io;
	}

	// -------------------------------------------------------------------
	// Per-player clocks (Fischer increment / time controls)
	// -------------------------------------------------------------------

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
			deadline: Date.now() + baseMs,
			timeout: null,
		};

		this.clocks.set(gameCode, state);
		this._scheduleFlagFall(gameCode);
		return this.getClockState(gameCode);
	}

	/**
	 * Call after a move is applied: stops the mover's clock (adding the
	 * increment), and starts the opponent's clock ticking.
	 * @param {string} gameCode
	 * @param {"white"|"black"} moverColor - the color that just moved
	 */
	applyMove(gameCode, moverColor) {
		const state = this.clocks.get(gameCode);
		if (!state) return null;

		const elapsed = Date.now() - (state.deadline - this._remainingMsFor(state, moverColor));
		const key = moverColor === "white" ? "whiteMs" : "blackMs";

		state[key] = Math.max(0, state[key] - elapsed) + state.incrementMs;
		state.turn = moverColor === "white" ? "black" : "white";
		state.deadline = Date.now() + this._remainingMsFor(state, state.turn);

		this._scheduleFlagFall(gameCode);
		return this.getClockState(gameCode);
	}

	_remainingMsFor(state, color) {
		return color === "white" ? state.whiteMs : state.blackMs;
	}

	/** Snapshot of remaining time for both players, accounting for the live tick. */
	getClockState(gameCode) {
		const state = this.clocks.get(gameCode);
		if (!state) return null;

		const now = Date.now();
		const activeRemaining = Math.max(0, state.deadline - now);
		const whiteMs = state.turn === "white" ? activeRemaining : state.whiteMs;
		const blackMs = state.turn === "black" ? activeRemaining : state.blackMs;

		return {
			whiteMs,
			blackMs,
			turn: state.turn,
			preset: state.preset,
			incrementMs: state.incrementMs,
		};
	}

	_scheduleFlagFall(gameCode) {
		const state = this.clocks.get(gameCode);
		if (!state) return;

		const remaining = this._remainingMsFor(state, state.turn);
		state.deadline = Date.now() + remaining;

		state.timeout = setTimeout(async () => {
			const loser = state.turn;
			this.clearClock(gameCode);
			try {
				const gameModel = require("../models/gameModel");
				const game = await gameModel.endByFlag(gameCode, loser);
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
	 */
	startTimer(gameCode, totalSeconds) {
		this.clearTimer(gameCode);

		let secondsLeft = Math.max(0, totalSeconds);

		const interval = setInterval(async () => {
			secondsLeft = Math.max(0, secondsLeft - 1);

			if (secondsLeft <= 0) {
				this.clearTimer(gameCode);
				try {
					const gameModel = require("../models/gameModel");
					const game = await gameModel.endByTime(gameCode);
					if (this.io && game) {
						this.io.to(gameCode).emit("game-update", game);
					}
				} catch (err) {
					console.error(`[TimerService] endByTime failed for ${gameCode}:`, err.message);
				}
			}
		}, 1000);

		this.timers.set(gameCode, { interval });
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
			this.reconnectTimers.delete(key);
			try {
				const gameModel = require("../models/gameModel");
				const game = await gameModel.forfeitByDisconnect(gameCode, color);
				this.clearClock(gameCode);
				if (this.io && game) {
					this.io.to(gameCode).emit("game-update", game);
					this.io.to(gameCode).emit("presence-update", {
						gameCode,
						color,
						status: "offline",
						forfeited: true,
					});
				}
			} catch (err) {
				console.error(`[TimerService] auto-forfeit failed for ${gameCode}/${color}:`, err.message);
			}
		}, graceSeconds * 1000);

		this.reconnectTimers.set(key, { timeout, expiresAt: Date.now() + graceSeconds * 1000 });
	}

	cancelReconnectGrace(gameCode, color) {
		const key = `${gameCode}:${color}`;
		const entry = this.reconnectTimers.get(key);
		if (entry) {
			clearTimeout(entry.timeout);
			this.reconnectTimers.delete(key);
			return true;
		}
		return false;
	}

	isPendingForfeit(gameCode, color) {
		return this.reconnectTimers.has(`${gameCode}:${color}`);
	}
}

module.exports = new TimerService();
module.exports.TIME_CONTROLS = TIME_CONTROLS;
module.exports.RECONNECT_GRACE_SECONDS = RECONNECT_GRACE_SECONDS;
