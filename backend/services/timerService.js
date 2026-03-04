class TimerService {
	constructor() {
		this.timers = new Map(); // gameCode -> { secondsLeft, interval }
		this.io = null;
	}

	init(io) {
		this.io = io;
	}

	/**
	 * Start the shared game countdown.
	 * When it hits zero, the player with the most material on the board wins.
	 * @param {string} gameCode
	 * @param {number} totalSeconds - total game duration from time control setting
	 */
	startTimer(gameCode, totalSeconds) {
		this.clearTimer(gameCode);

		let secondsLeft = Math.max(0, totalSeconds);

		if (this.io) {
			this.io.to(gameCode).emit("timer-tick", { secondsLeft });
		}

		const interval = setInterval(async () => {
			secondsLeft = Math.max(0, secondsLeft - 1);

			if (this.io) {
				this.io.to(gameCode).emit("timer-tick", { secondsLeft });
			}

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
}

module.exports = new TimerService();
