const gameModel = require("../models/gameModel");
const timerService = require("../services/timerService");
const replayService = require("../services/replayService");

// Comment line sent periodically so proxies don't drop an idle replay stream.
const REPLAY_HEARTBEAT_MS = 15000;

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

			timerService.clearTimer(gameCode);
			timerService.clearClock(gameCode);

			const io = req.app.get("io");
			io.to(gameCode).emit("game-update", game);

			res.json({ success: true, data: game });
		} catch (error) {
			res.status(400).json({ success: false, error: error.message });
		}
	}

	async claimDraw(req, res) {
		try {
			const { gameCode } = req.params;
			const game = await gameModel.claimDraw(gameCode);

			timerService.clearTimer(gameCode);
			timerService.clearClock(gameCode);

			const io = req.app.get("io");
			io.to(gameCode).emit("game-update", game);

			res.json({ success: true, data: game });
		} catch (error) {
			res.status(400).json({ success: false, error: error.message });
		}
	}

	/**
	 * GET /api/games/:id/stream?speed=1|2|5 (Issue #245)
	 * Replays a game's moves over Server-Sent Events, pacing each `move`
	 * event by the move's original duration divided by the speed multiplier.
	 * Events: `start` (game metadata), `move` (one per move, `id` = move
	 * index, so clients can resume with Last-Event-ID) and `end` (result).
	 */
	async streamGameReplay(req, res) {
		const { id } = req.params;
		const speed = replayService.parseSpeed(req.query.speed);
		if (speed === null) {
			return res.status(400).json({
				success: false,
				error: `speed must be a number between ${replayService.MIN_SPEED} and ${replayService.MAX_SPEED}`,
			});
		}

		let game;
		let frames;
		try {
			game = await gameModel.getGame(id);
			if (!game) throw new Error("Game not found");
			frames = replayService.buildReplayFrames(game, await gameModel.getMoves(id));
		} catch (error) {
			return res.status(404).json({ success: false, error: error.message });
		}

		// Resume after the last move the client saw (reconnect or ?from=N).
		const resumeFrom = parseInt(req.headers["last-event-id"] ?? req.query.from ?? "0", 10);
		let next = Number.isInteger(resumeFrom) ? Math.min(Math.max(resumeFrom, 0), frames.length) : 0;

		res.writeHead(200, {
			"Content-Type": "text/event-stream; charset=utf-8",
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive",
			"X-Accel-Buffering": "no",
		});

		let closed = false;
		let timer = null;
		const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), REPLAY_HEARTBEAT_MS);

		const cleanup = () => {
			closed = true;
			clearTimeout(timer);
			clearInterval(heartbeat);
		};
		// "close" fires when the client disconnects (and after res.end()).
		res.on("close", cleanup);

		const send = (event, onFlushed) => {
			if (res.write(replayService.formatSSE(event))) onFlushed();
			else res.once("drain", onFlushed);
		};

		const scheduleNext = () => {
			if (closed) return;
			if (next >= frames.length) {
				send({
					event: "end",
					data: { gameCode: game.game_code, status: game.status, winner: game.winner || null, endReason: game.end_reason || null },
				}, () => {});
				cleanup();
				res.end();
				return;
			}

			const frame = frames[next];
			timer = setTimeout(() => {
				if (closed) return;
				next += 1;
				send({ event: "move", id: frame.index, data: frame }, scheduleNext);
			}, replayService.replayDelayMs(frame.durationMs, speed));
		};

		res.write(`retry: 3000\n\n`);
		send({
			event: "start",
			data: {
				gameCode: game.game_code,
				speed,
				totalMoves: frames.length,
				resumeFrom: next,
				players: { white: game.player_white_address || null, black: game.player_black_address || null },
				timeControlSeconds: game.time_control_seconds ?? null,
				incrementSeconds: game.time_increment_seconds ?? null,
				startedAt: game.game_started_at || null,
			},
		}, scheduleNext);
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
