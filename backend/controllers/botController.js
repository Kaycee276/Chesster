const botService = require("../services/botService");
const gameModel = require("../models/gameModel");

class BotController {
	/**
	 * POST /api/bot/move
	 * Stateless mode: body = { board, turn, lastMove?, difficulty?, moveCount? }
	 * Returns the engine's chosen move without touching the database — lets
	 * a single-player client keep the board on its own side if it wants to.
	 */
	async getMove(req, res) {
		try {
			const { board, turn, lastMove, difficulty, moveCount } = req.body;
			if (!board || !turn) {
				return res.status(400).json({ success: false, error: "board and turn are required" });
			}

			const move = await botService.getBestMove(board, turn, lastMove || null, difficulty, moveCount || 0);
			if (!move) {
				return res.status(200).json({ success: true, data: null, message: "No legal moves (checkmate/stalemate)" });
			}

			res.json({ success: true, data: move });
		} catch (error) {
			res.status(500).json({ success: false, error: error.message });
		}
	}

	/**
	 * POST /api/games/:gameCode/bot-move
	 * Stateful mode: fetches the persisted game, asks the bot for a move on
	 * the side to play, and applies it via the normal gameModel.makeMove
	 * flow (validation, checkmate/stalemate detection, move history, ...).
	 */
	async playBotMove(req, res) {
		try {
			const { gameCode } = req.params;
			const { difficulty } = req.body || {};

			const game = await gameModel.getGame(gameCode);
			if (!game) return res.status(404).json({ success: false, error: "Game not found" });
			if (game.status !== "active") {
				return res.status(400).json({ success: false, error: "Game is not active" });
			}

			const move = await botService.getBestMove(
				game.board_state,
				game.current_turn,
				game.last_move || null,
				difficulty,
				game.move_count || 0,
			);

			if (!move) {
				return res.status(200).json({ success: true, data: game, message: "Bot has no legal moves" });
			}

			const updatedGame = await gameModel.makeMove(gameCode, move.from, move.to, move.promotion);

			const io = req.app.get("io");
			io.to(gameCode).emit("game-update", updatedGame);
			io.to(gameCode).emit("bot-move", { gameCode, move });

			res.json({ success: true, data: updatedGame, move });
		} catch (error) {
			res.status(400).json({ success: false, error: error.message });
		}
	}
}

module.exports = new BotController();
