const gameModel = require("../models/gameModel");
const timerService = require("../services/timerService");

class GameController {
	async createGame(req, res) {
		try {
			const { gameType, wagerAmount, playerWhiteAddress, timeControlSeconds } = req.body;
			const game = await gameModel.createGame(
				gameType,
				wagerAmount,
				playerWhiteAddress,
				timeControlSeconds || 600,
			);
			res.status(201).json({ success: true, data: game });
		} catch (error) {
			res.status(500).json({ success: false, error: error.message });
		}
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

			const io = req.app.get("io");
			io.to(gameCode).emit("game-update", game);

			if (game.status === "active") {
				const tcs = game.time_control_seconds || 600;
				const whiteLeft = game.white_time_left ?? tcs;
				const blackLeft = game.black_time_left ?? tcs;
				timerService.startClock(gameCode, whiteLeft, blackLeft, "white");
			}

			res.json({ success: true, data: game });
		} catch (error) {
			res.status(400).json({ success: false, error: error.message });
		}
	}

	async getGame(req, res) {
		try {
			const { gameCode } = req.params;
			const game = await gameModel.getGame(gameCode);
			res.json({ success: true, data: game });
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

			// Snapshot time before switching turn so we persist it
			const times = timerService.getTime(gameCode);

			const game = await gameModel.makeMove(
				gameCode,
				from,
				to,
				promotion,
				times?.whiteLeft ?? null,
				times?.blackLeft ?? null,
			);

			const io = req.app.get("io");
			io.to(gameCode).emit("game-update", game);

			if (game.status === "active") {
				timerService.switchTurn(gameCode, game.current_turn);
			} else {
				timerService.clearTimer(gameCode);
			}

			res.json({ success: true, data: game });
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

			const io = req.app.get("io");
			io.to(gameCode).emit("game-update", game);

			res.json({ success: true, data: game });
		} catch (error) {
			res.status(400).json({ success: false, error: error.message });
		}
	}
}

module.exports = new GameController();
