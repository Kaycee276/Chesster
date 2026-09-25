const chessEngine = require("./chessEngine");

/**
 * Pure move helpers shared by botService (main thread) and the Stockfish
 * worker threads (backend/workers/stockfishWorker.js). Kept free of any
 * worker/pool wiring so a worker can load it without pulling in the pool.
 */

/** square like "e2" -> [row, col] in this project's board coordinates. */
function squareToCoords(square) {
	const file = square.charCodeAt(0) - "a".charCodeAt(0);
	const rank = parseInt(square[1], 10);
	return [8 - rank, file];
}

/** [row, col] -> square like "e2". */
function coordsToSquare([row, col]) {
	return `${String.fromCharCode("a".charCodeAt(0) + col)}${8 - row}`;
}

const UCI_MOVE_PATTERN = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

/** Parse a UCI move string ("e2e4", "e7e8q") into { from, to, promotion }. */
function parseUciMove(uci) {
	if (typeof uci !== "string" || !UCI_MOVE_PATTERN.test(uci)) return null;
	const from = squareToCoords(uci.slice(0, 2));
	const to = squareToCoords(uci.slice(2, 4));
	const promotion = uci.length > 4 ? uci[4] : null;
	return { from, to, promotion };
}

/** { from, to, promotion } -> UCI move string ("e2e4", "e7e8q"). */
function toUciMove({ from, to, promotion }) {
	return `${coordsToSquare(from)}${coordsToSquare(to)}${promotion ? promotion.toLowerCase() : ""}`;
}

/** Enumerate all legal moves for `color` on `board` using the existing rules engine. */
function getLegalMoves(board, color, lastMove) {
	const moves = [];
	for (let r = 0; r < 8; r++) {
		for (let c = 0; c < 8; c++) {
			const piece = board[r][c];
			if (piece === ".") continue;
			const isOwn = color === "white" ? piece === piece.toUpperCase() : piece === piece.toLowerCase();
			if (!isOwn) continue;

			for (let tr = 0; tr < 8; tr++) {
				for (let tc = 0; tc < 8; tc++) {
					const result = chessEngine.isValidMove(board, [r, c], [tr, tc], color, lastMove);
					if (result.valid) {
						const isPromotion = piece.toLowerCase() === "p" && (tr === 0 || tr === 7);
						moves.push({ from: [r, c], to: [tr, tc], promotion: isPromotion ? "q" : null, piece });
					}
				}
			}
		}
	}
	return moves;
}

const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/**
 * Heuristic fallback move picker, used when no Stockfish binary is
 * reachable. Not engine-strength, but never illegal and scales roughly
 * with skillLevel: higher skill prefers capturing the most valuable piece,
 * lower skill picks uniformly at random among legal moves.
 */
function pickHeuristicMove(board, color, lastMove, skillLevel) {
	const moves = getLegalMoves(board, color, lastMove);
	if (moves.length === 0) return null;

	const randomness = Math.max(0, 1 - skillLevel / 20); // 1 = fully random, 0 = always best capture
	if (Math.random() < randomness) {
		return moves[Math.floor(Math.random() * moves.length)];
	}

	let best = moves[0];
	let bestValue = -1;
	for (const move of moves) {
		const target = board[move.to[0]][move.to[1]];
		const value = target === "." ? 0 : (PIECE_VALUE[target.toLowerCase()] || 0);
		if (value > bestValue) {
			bestValue = value;
			best = move;
		}
	}
	return best;
}

module.exports = {
	squareToCoords,
	coordsToSquare,
	parseUciMove,
	toUciMove,
	getLegalMoves,
	pickHeuristicMove,
};
