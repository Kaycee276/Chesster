const crypto = require("crypto");
const puzzleModel = require("../models/puzzleModel");
const userModel = require("../models/userModel");

const DAILY_CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=60";

function buildPuzzleEtag(puzzle) {
	const hash = crypto
		.createHash("md5")
		.update(String(puzzle.id || "") + String(puzzle.date || ""))
		.digest("hex");
	return `"${hash}"`;
}

function buildLegacyPuzzleEtag(puzzle) {
	const hash = crypto
		.createHash("md5")
		.update(String(puzzle.id || "") + String(puzzle.fen || "") + String(puzzle.date || ""))
		.digest("hex");
	return `"${hash}"`;
}

// Honors comma-separated lists, weak validators (W/) and the "*" wildcard.
function etagMatches(header, etag, legacyEtag = null) {
	if (!header) return false;
	return header
		.split(",")
		.map((candidate) => candidate.trim().replace(/^W\//, ""))
		.some((candidate) => candidate === "*" || candidate === etag || (legacyEtag && candidate === legacyEtag));
}

function puzzleCacheControlMiddleware(maxAge = 300, staleWhileRevalidate = 60) {
	const headerValue = `public, max-age=${maxAge}, stale-while-revalidate=${staleWhileRevalidate}`;
	return (_req, res, next) => {
		res.locals.puzzleCacheControl = headerValue;
		next();
	};
}

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
  async getAdaptivePuzzle(req, res) {
    const targetRating = Number(req.query.targetRating);
    const range = req.query.range === undefined ? 100 : Number(req.query.range);
    const excludeId = req.query.excludeId;
    if (!Number.isFinite(targetRating) || req.query.targetRating === "" ||
        !Number.isInteger(range) || range < 1 || range > 500 ||
        (excludeId !== undefined && (typeof excludeId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(excludeId)))) {
      return res.status(400).json({ success: false, error: "Provide a targetRating, range from 1 to 500, and a valid optional excludeId." });
    }
    try {
      const puzzle = await puzzleModel.getAdaptivePuzzle(targetRating, range, excludeId);
      if (!puzzle) return res.status(404).json({ success: false, error: "No puzzles available in this rating range." });
      const sideToMove = puzzle.side_to_move;
      const solution = normalizeMoves(puzzle.solution_moves).map((move, index) => {
        const square = (file, rank) => [8 - Number(rank), file.charCodeAt(0) - 97];
        const promotion = move[4];
        const white = (index % 2 === 0) === (sideToMove === "white");
        return { from: square(move[0], move[1]), to: square(move[2], move[3]),
          ...(promotion ? { promotion: white ? promotion.toUpperCase() : promotion } : {}) };
      });
      // This line serves local practice only. Server rewards still use authenticated verification.
      return res.json({ success: true, data: { id: puzzle.id, fen: puzzle.fen,
        sideToMove, rating: puzzle.rating, themes: [], solution } });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }

	async getDailyPuzzle(req, res) {
		try {
			const puzzle = await puzzleModel.getDailyPuzzle(new Date());
			if (!puzzle) {
				return res.status(404).json({ success: false, error: "No daily puzzle available" });
			}
			const etag = buildPuzzleEtag(puzzle);
			const legacyEtag = buildLegacyPuzzleEtag(puzzle);
			res.setHeader("Cache-Control", res.locals?.puzzleCacheControl || DAILY_CACHE_CONTROL);
			res.setHeader("ETag", etag);
			if (etagMatches(req.headers["if-none-match"], etag, legacyEtag)) {
				return res.status(304).end();
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
module.exports.buildPuzzleEtag = buildPuzzleEtag;
module.exports.etagMatches = etagMatches;
module.exports.puzzleCacheControlMiddleware = puzzleCacheControlMiddleware;
