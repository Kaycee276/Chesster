const TURN_TIME_LIMIT_SECONDS = 45;

class TimerService {
	constructor() {
		this.timers = new Map(); // gameCode -> { timeout, interval }
		this.io = null;
		this.TURN_TIME_LIMIT_SECONDS = TURN_TIME_LIMIT_SECONDS;
	}

	init(io) {
		this.io = io;
	}

	startTimer(gameCode) {
		this.clearTimer(gameCode);

		let secondsLeft = TURN_TIME_LIMIT_SECONDS;

		// Broadcast initial value immediately
		if (this.io) {
			this.io.to(gameCode).emit("timer-tick", { secondsLeft });
		}

		// Tick every second and broadcast remaining time to both players
		const interval = setInterval(() => {
			secondsLeft -= 1;
			if (this.io) {
				this.io.to(gameCode).emit("timer-tick", { secondsLeft: Math.max(0, secondsLeft) });
			}
		}, 1000);

		// Forfeit the turn when time runs out
		const timeout = setTimeout(async () => {
			this.clearTimer(gameCode);
			try {
				// Lazy require to avoid circular dependency
				const gameModel = require("../models/gameModel");
				const game = await gameModel.forfeitTurn(gameCode);
				if (this.io && game) {
					this.io.to(gameCode).emit("game-update", game);
				}
				// Start next player's timer if game is still active
				if (game && game.status === "active") {
					this.startTimer(gameCode);
				}
			} catch (err) {
				console.error(
					`[TimerService] Failed to forfeit turn for ${gameCode}:`,
					err.message,
				);
			}
		}, TURN_TIME_LIMIT_SECONDS * 1000);

		this.timers.set(gameCode, { timeout, interval });
	}

	clearTimer(gameCode) {
		const timer = this.timers.get(gameCode);
		if (timer) {
			clearTimeout(timer.timeout);
			clearInterval(timer.interval);
			this.timers.delete(gameCode);
		}
	}
}

module.exports = new TimerService();
