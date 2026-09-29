const puzzleModel = require("../models/puzzleModel");
const userModel = require("../models/userModel");

const UCI_MOVE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

function normalizeMoves(moves) {
	if (!Array.isArray(moves) || moves.length === 0) {
		throw new Error("moves must be a non-empty array of UCI moves");
	}
	return moves.map((move) => {
		const normalized = String(move).trim().toLowerCase();
		if (!UCI_MOVE.test(normalized)) throw new Error(`Invalid UCI move: ${move}`);
		return normalized;
	});
}

class PuzzleController {
	async getDailyPuzzle(req, res) {
		try {
			const puzzle = await puzzleModel.getDailyPuzzle(new Date());
			if (!puzzle) {
				return res.status(404).json({ success: false, error: "No daily puzzle available" });
			}
			return res.json({
				success: true,
				data: {
					id: puzzle.id,
					fen: puzzle.fen,
					sideToMove: puzzle.side_to_move,
					rating: puzzle.rating,
					date: puzzle.date,
				},
			});
		} catch (error) {
			return res.status(500).json({ success: false, error: error.message });
		}
	}

	async verifyPuzzleSolution(req, res) {
		try {
			const submittedMoves = normalizeMoves(req.body?.moves);
			const puzzle = await puzzleModel.getById(req.params.id);
			if (!puzzle) {
				return res.status(404).json({ success: false, error: "Puzzle not found" });
			}

			const solution = (puzzle.solution_moves || []).map((move) => String(move).toLowerCase());
			const correct = submittedMoves.length === solution.length
				&& submittedMoves.every((move, index) => move === solution[index]);

			if (!correct) return res.json({ success: true, correct: false, reward: null });

			const solvedOn = new Date().toISOString().slice(0, 10);
			const reward = await userModel.recordPuzzleSolve(
				req.user.address,
				puzzle.id,
				solvedOn,
				10,
			);
			return res.json({ success: true, correct: true, reward });
		} catch (error) {
			const status = /moves|UCI/.test(error.message) ? 400 : 500;
			return res.status(status).json({ success: false, error: error.message });
		}
	}
}

module.exports = new PuzzleController();
module.exports.normalizeMoves = normalizeMoves;
