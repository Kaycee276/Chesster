const gameModel = require("../models/gameModel");
const timerService = require("../services/timerService");

class GameController {
	async createGame(req, res) {
		try {
			const {
				gameType,
				wagerAmount,
				playerWhiteAddress,
				timeControlSeconds,
				gameCode,
				timeControlPreset,
				timeIncrementSeconds,
			} = req.body;

			const game = await gameModel.createGame(
				gameType,
				wagerAmount,
				playerWhiteAddress,
				timeControlSeconds || 600,
				gameCode || null,
				timeControlPreset || null,
				timeIncrementSeconds || 0,
			);
			res.status(201).json({ success: true, data: game });
		} catch (error) {
			res.status(500).json({ success: false, error: error.message });
		}
	}

	/** GET /api/time-controls — expose the supported presets to clients. */
	async getTimeControls(req, res) {
		res.json({ success: true, data: timerService.getTimeControls() });
	}

	async joinGame(req, res) {
		try {
			const { gameCode } = req.params;
			const { playerColor, playerAddress } = req.body;
			const game = await gameModel.joinGame(
				gameCode,
				playerColor,
				playerAddress,
			);

			let clock = null;
			if (game.status === "active") {
				clock = timerService.startClock(gameCode, {
					preset: game.time_control_preset,
					baseSeconds: game.time_control_seconds || 600,
					incrementSeconds: game.time_increment_seconds || 0,
					turn: game.current_turn || "white",
				});
			}

			const io = req.app.get("io");
			io.to(gameCode).emit("game-update", { ...game, clock });

			res.json({ success: true, data: { ...game, clock } });
		} catch (error) {
			res.status(400).json({ success: false, error: error.message });
		}
	}

	async getGame(req, res) {
		try {
			const { gameCode } = req.params;
			const game = await gameModel.getGame(gameCode);
			const clock = timerService.getClockState(gameCode);
			res.json({ success: true, data: { ...game, clock } });
		} catch (error) {
			res.status(404).json({ success: false, error: error.message });
		}
	}

	async getPendingGames(req, res) {
		try {
			const games = await gameModel.getPendingGames();
			res.json({ success: true, data: games });
		} catch (error) {
			res.status(500).json({ success: false, error: error.message });
		}
	}

	async makeMove(req, res) {
		try {
			const { gameCode } = req.params;
			const { from, to, promotion } = req.body;

			const moverColor = (await gameModel.getGame(gameCode)).current_turn;
			const game = await gameModel.makeMove(gameCode, from, to, promotion);

			// Record timing for anti-cheat analysis (non-blocking — never fails the move)
			try {
				const antiCheat = require("../services/antiCheatService");
				const { flagged, reasons } = antiCheat.recordMove(gameCode, moverColor);
				if (flagged) {
					const logger = require("../utils/logger");
					logger.warn("Anti-cheat flag", { gameCode, color: moverColor, reasons });
				}
				if (game.status !== "active") antiCheat.clearGame(gameCode);
			} catch { /* non-critical */ }

			let clock = null;
			if (game.status === "active") {
				clock = timerService.applyMove(gameCode, moverColor);
			} else {
				timerService.clearTimer(gameCode);
				timerService.clearClock(gameCode);
			}

			const io = req.app.get("io");
			io.to(gameCode).emit("game-update", { ...game, clock });

			res.json({ success: true, data: { ...game, clock } });
		} catch (error) {
			res.status(400).json({ success: false, error: error.message });
		}
	}

	async getMoves(req, res) {
		try {
			const { gameCode } = req.params;
			const moves = await gameModel.getMoves(gameCode);
			res.json({ success: true, data: moves });
		} catch (error) {
			res.status(404).json({ success: false, error: error.message });
		}
	}

	async resignGame(req, res) {
		try {
			const { gameCode } = req.params;
			const { playerColor } = req.body;
			const game = await gameModel.resignGame(gameCode, playerColor);

			timerService.clearTimer(gameCode);
			timerService.clearClock(gameCode);

			const io = req.app.get("io");
			io.to(gameCode).emit("game-update", game);

			res.json({ success: true, data: game });
		} catch (error) {
			res.status(400).json({ success: false, error: error.message });
		}
	}

	async offerDraw(req, res) {
		try {
			const { gameCode } = req.params;
			const { playerColor } = req.body;
			const game = await gameModel.offerDraw(gameCode, playerColor);

			const io = req.app.get("io");
			io.to(gameCode).emit("game-update", game);

			res.json({ success: true, data: game });
		} catch (error) {
			res.status(400).json({ success: false, error: error.message });
		}
	}

	async acceptDraw(req, res) {
		try {
			const { gameCode } = req.params;
			const game = await gameModel.acceptDraw(gameCode);

			timerService.clearTimer(gameCode);
			timerService.clearClock(gameCode);

			const io = req.app.get("io");
			io.to(gameCode).emit("game-update", game);

			res.json({ success: true, data: game });
		} catch (error) {
			res.status(400).json({ success: false, error: error.message });
		}
	}

	async getChatMessages(req, res) {
		try {
			const { gameCode } = req.params;
			const messages = await gameModel.getChatMessages(gameCode);
			res.json({ success: true, data: messages });
		} catch (error) {
			res.status(404).json({ success: false, error: error.message });
		}
	}

	async getGameHistory(req, res) {
		try {
			const {
				playerAddress,
				status,
				dateFrom,
				dateTo,
				page = 1,
				pageSize = 20,
				sortBy = "created_at",
				sortOrder = "desc",
			} = req.query;

			const filters = {
				playerAddress: playerAddress || null,
				status: status || null,
				dateFrom: dateFrom || null,
				dateTo: dateTo || null,
				page: page || 1,
				pageSize: pageSize || 20,
				sortBy: sortBy || "created_at",
				sortOrder: sortOrder || "desc",
			};

			const result = await gameModel.getGameHistory(filters);
			res.json({ success: true, ...result });
		} catch (error) {
			res.status(500).json({ success: false, error: error.message });
		}
	}

	async requestUndoMove(req, res) {
		try {
			const { gameCode } = req.params;
			const { playerColor } = req.body;

			const game = await gameModel.requestUndoMove(gameCode, playerColor);

			const io = req.app.get("io");
			io.to(gameCode).emit("game-update", game);

			res.json({ success: true, data: game });
		} catch (error) {
			res.status(400).json({ success: false, error: error.message });
		}
	}

	async acceptUndoMove(req, res) {
		try {
			const { gameCode } = req.params;
			const { playerColor } = req.body;

			const game = await gameModel.acceptUndoMove(gameCode, playerColor);

			const io = req.app.get("io");
			io.to(gameCode).emit("game-update", game);

			res.json({ success: true, data: game });
		} catch (error) {
			res.status(400).json({ success: false, error: error.message });
		}
	}

	async rejectUndoMove(req, res) {
		try {
			const { gameCode } = req.params;

			const game = await gameModel.rejectUndoMove(gameCode);

			const io = req.app.get("io");
			io.to(gameCode).emit("game-update", game);

			res.json({ success: true, data: game });
		} catch (error) {
			res.status(400).json({ success: false, error: error.message });
		}
	}
}

module.exports = new GameController();
