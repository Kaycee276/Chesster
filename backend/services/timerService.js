class TimerService {
	constructor() {
		this.clocks = new Map(); // gameCode -> { whiteLeft, blackLeft, currentTurn, interval }
		this.io = null;
	}

	init(io) {
		this.io = io;
	}

	/**
	 * Start (or restart) the chess clock for a game.
	 * @param {string} gameCode
	 * @param {number} whiteLeft  - seconds remaining for white
	 * @param {number} blackLeft  - seconds remaining for black
	 * @param {string} currentTurn - "white" | "black"
	 */
	startClock(gameCode, whiteLeft, blackLeft, currentTurn) {
		this.clearTimer(gameCode);

		const state = {
			whiteLeft: Math.max(0, whiteLeft),
			blackLeft: Math.max(0, blackLeft),
			currentTurn,
		};

		// Broadcast initial state immediately
		if (this.io) {
			this.io.to(gameCode).emit("timer-tick", {
				whiteTimeLeft: state.whiteLeft,
				blackTimeLeft: state.blackLeft,
			});
		}

		const interval = setInterval(async () => {
			if (state.currentTurn === "white") {
				state.whiteLeft = Math.max(0, state.whiteLeft - 1);
			} else {
				state.blackLeft = Math.max(0, state.blackLeft - 1);
			}

			if (this.io) {
				this.io.to(gameCode).emit("timer-tick", {
					whiteTimeLeft: state.whiteLeft,
					blackTimeLeft: state.blackLeft,
				});
			}

			// Check for time-out
			const timedOut =
				(state.currentTurn === "white" && state.whiteLeft <= 0) ||
				(state.currentTurn === "black" && state.blackLeft <= 0);

			if (timedOut) {
				this.clearTimer(gameCode);
				try {
					const gameModel = require("../models/gameModel");
					const winner = state.currentTurn === "white" ? "black" : "white";
					const game = await gameModel.loseByTime(gameCode, winner);
					if (this.io && game) {
						this.io.to(gameCode).emit("game-update", game);
					}
				} catch (err) {
					console.error(`[TimerService] loseByTime failed for ${gameCode}:`, err.message);
				}
			}
		}, 1000);

		this.clocks.set(gameCode, { state, interval });
	}

	/**
	 * Switch whose clock is ticking (called after a move).
	 * Returns current { whiteLeft, blackLeft } so controller can persist to DB.
	 */
	switchTurn(gameCode, newTurn) {
		const entry = this.clocks.get(gameCode);
		if (entry) {
			entry.state.currentTurn = newTurn;
			return { whiteLeft: entry.state.whiteLeft, blackLeft: entry.state.blackLeft };
		}
		return null;
	}

	/** Get current time left for both players */
	getTime(gameCode) {
		const entry = this.clocks.get(gameCode);
		if (!entry) return null;
		return { whiteLeft: entry.state.whiteLeft, blackLeft: entry.state.blackLeft };
	}

	clearTimer(gameCode) {
		const entry = this.clocks.get(gameCode);
		if (entry) {
			clearInterval(entry.interval);
			this.clocks.delete(gameCode);
		}
	}

	// Legacy alias — no-op now
	startTimer() {
		console.warn("[TimerService] startTimer() called — use startClock() instead");
	}
}

module.exports = new TimerService();
