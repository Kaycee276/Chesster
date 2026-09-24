const gameModel = require("../models/gameModel");
const timerService = require("../services/timerService");
const eventBus = require("../services/eventBus");

class GameController {
	publishGameEnded(game, endReason) {
		if (!game || game.status !== "finished") return;
		const winnerAddress = game.winner === "white"
			? game.player_white_address
			: game.winner === "black" ? game.player_black_address : null;
		eventBus.publish("game.ended", {
			gameId: game.id,
			gameCode: game.game_code,
			winner: game.winner,
			winnerAddress,
			playerWhiteAddress: game.player_white_address,
			playerBlackAddress: game.player_black_address,
			endReason: endReason || game.end_reason || "conclusion",
		}).catch(() => {});
	}

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
			const { playerColor, playerAddress, referralCode } = req.body;
			if (playerAddress && referralCode) {
				const userModel = require("../models/userModel");
				await userModel.findOrCreateByAddress(playerAddress, referralCode);
			}
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
				this.publishGameEnded(game);

				// If tournament match concluded, advance round
				if (game.status === "finished") {
					try {
						const tournamentModel = require("../models/tournamentModel");
						const tournamentService = require("../services/tournamentService");
						const match = await tournamentModel.getMatchByGameCode(gameCode);
						const winningAddress = game.winner === "white" ? game.player_white_address : game.player_black_address;
						if (match && winningAddress) {
							tournamentService.advanceRound(match.tournament_id, match.id, winningAddress).catch(() => {});
						}
					} catch { /* non-critical */ }
				}
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
			this.publishGameEnded(game, "resignation");

			timerService.clearTimer(gameCode);
			timerService.clearClock(gameCode);

			// If tournament match concluded, advance round
			try {
				const tournamentModel = require("../models/tournamentModel");
				const tournamentService = require("../services/tournamentService");
				const match = await tournamentModel.getMatchByGameCode(gameCode);
				const winningAddress = playerColor === "white" ? game.player_black_address : game.player_white_address;
				if (match && winningAddress) {
					tournamentService.advanceRound(match.tournament_id, match.id, winningAddress).catch(() => {});
				}
			} catch { /* non-critical */ }

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
			this.publishGameEnded(game, "draw_agreed");

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

	/**
	 * Concludes a game, settles timers, and hooks into tournament advancement if linked to a match.
	 */
	async endGame(req, res) {
		try {
			const { gameCode } = req.params;
			const { winner, winnerAddress, endReason } = req.body;

			const tournamentModel = require("../models/tournamentModel");
			const tournamentService = require("../services/tournamentService");

			const game = await gameModel.getGame(gameCode);
			if (!game) {
				return res.status(404).json({ success: false, error: "Game not found" });
			}

			let winningAddress = winnerAddress;
			if (!winningAddress) {
				if (winner === "white") winningAddress = game.player_white_address;
				else if (winner === "black") winningAddress = game.player_black_address;
			}

			let tournamentAdvancement = null;
			const match = await tournamentModel.getMatchByGameCode(gameCode);
			if (match && winningAddress) {
				tournamentAdvancement = await tournamentService.advanceRound(
					match.tournament_id,
					match.id,
					winningAddress,
				);
			}

			timerService.clearTimer(gameCode);
			timerService.clearClock(gameCode);

			const io = req.app.get("io");
			if (io) {
				io.to(gameCode).emit("game-ended", {
					gameCode,
					winner,
					winnerAddress: winningAddress,
					endReason: endReason || "conclusion",
				});
			}

			eventBus.publish("game.ended", {
				gameId: game.id,
				gameCode,
				winner,
				winnerAddress: winningAddress,
				playerWhiteAddress: game.player_white_address,
				playerBlackAddress: game.player_black_address,
				endReason: endReason || "conclusion",
			}).catch(() => {});

			res.json({
				success: true,
				data: {
					gameCode,
					winner,
					winnerAddress: winningAddress,
					tournamentAdvancement,
				},
			});
		} catch (error) {
			res.status(500).json({ success: false, error: error.message });
		}
	}
}

module.exports = new GameController();
