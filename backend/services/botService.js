const { spawn } = require("child_process");
const chessEngine = require("./chessEngine");

// Path to a UCI-speaking Stockfish binary. Not bundled with this repo (the
// official `stockfish` npm package ships 100MB+ of prebuilt WASM binaries
// per platform, which is heavy for this project) — instead we shell out to
// whatever engine is available on the host, same as most self-hosted chess
// servers do. Set STOCKFISH_PATH to point at a real Stockfish executable in
// any environment where bots should actually play at engine strength.
const STOCKFISH_PATH = process.env.STOCKFISH_PATH || "stockfish";
const ENGINE_MOVE_TIME_MS = parseInt(process.env.STOCKFISH_MOVE_TIME_MS || "800", 10);

// Difficulty presets map to the UCI "Skill Level" option (0-20).
const DIFFICULTY_SKILL = { easy: 2, medium: 10, hard: 18, maximum: 20 };

function resolveSkillLevel(difficulty) {
	if (typeof difficulty === "number") {
		return Math.max(0, Math.min(20, Math.round(difficulty)));
	}
	if (typeof difficulty === "string" && DIFFICULTY_SKILL[difficulty] !== undefined) {
		return DIFFICULTY_SKILL[difficulty];
	}
	return DIFFICULTY_SKILL.medium;
}

/**
 * Convert this project's 8x8 char-array board (row 0 = rank 8, matching
 * chessEngine.initBoard()) into a FEN position string.
 *
 * Castling rights and en-passant target aren't tracked by chessEngine, so
 * they're conservatively reported as unavailable ("-"). This slightly
 * under-informs the engine (it won't consider castling/en-passant replies)
 * but never produces an illegal position.
 */
function boardToFEN(board, turn, moveCount = 0) {
	const rows = board.map((row) => {
		let fenRow = "";
		let empty = 0;
		for (const cell of row) {
			if (cell === ".") {
				empty += 1;
			} else {
				if (empty > 0) {
					fenRow += empty;
					empty = 0;
				}
				fenRow += cell;
			}
		}
		if (empty > 0) fenRow += empty;
		return fenRow;
	});

	const placement = rows.join("/");
	const active = turn === "black" ? "b" : "w";
	const fullmove = Math.max(1, Math.floor(moveCount / 2) + 1);

	return `${placement} ${active} - - 0 ${fullmove}`;
}

/** square like "e2" -> [row, col] in this project's board coordinates. */
function squareToCoords(square) {
	const file = square.charCodeAt(0) - "a".charCodeAt(0);
	const rank = parseInt(square[1], 10);
	return [8 - rank, file];
}

/** Parse a UCI move string ("e2e4", "e7e8q") into { from, to, promotion }. */
function parseUciMove(uci) {
	if (!uci || uci.length < 4) return null;
	const from = squareToCoords(uci.slice(0, 2));
	const to = squareToCoords(uci.slice(2, 4));
	const promotion = uci.length > 4 ? uci[4] : null;
	return { from, to, promotion };
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

/**
 * Ask a locally installed Stockfish binary (UCI protocol over stdio) for
 * its best move in the given position. Resolves to a UCI move string
 * (e.g. "e2e4") or rejects if the engine isn't available / times out.
 */
function askStockfish(fen, skillLevel) {
	return new Promise((resolve, reject) => {
		let engine;
		try {
			engine = spawn(STOCKFISH_PATH, [], { stdio: ["pipe", "pipe", "pipe"] });
		} catch (err) {
			return reject(err);
		}

		let buffer = "";
		let settled = false;

		const finish = (err, result) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			try {
				engine.stdin.end();
				engine.kill();
			} catch (_) { /* already exited */ }
			if (err) reject(err);
			else resolve(result);
		};

		const timeout = setTimeout(() => finish(new Error("Stockfish timed out")), ENGINE_MOVE_TIME_MS + 5000);

		engine.on("error", (err) => finish(err));
		engine.on("exit", (code) => {
			if (!settled && code !== 0) finish(new Error(`Stockfish exited with code ${code}`));
		});

		engine.stdout.on("data", (chunk) => {
			buffer += chunk.toString();
			const lines = buffer.split("\n");
			buffer = lines.pop();

			for (const line of lines) {
				if (line.startsWith("bestmove")) {
					const parts = line.trim().split(/\s+/);
					finish(null, parts[1]);
					return;
				}
			}
		});

		engine.stdin.write("uci\n");
		engine.stdin.write(`setoption name Skill Level value ${skillLevel}\n`);
		engine.stdin.write("isready\n");
		engine.stdin.write(`position fen ${fen}\n`);
		engine.stdin.write(`go movetime ${ENGINE_MOVE_TIME_MS}\n`);
	});
}

class BotService {
	/**
	 * Compute the bot's move for a single-player game.
	 * @param {string[][]} board - internal board representation
	 * @param {"white"|"black"} turn - color the bot is playing
	 * @param {object|null} lastMove - { from, to, piece } of the last move (for en passant)
	 * @param {string|number} difficulty - "easy"|"medium"|"hard"|"maximum" or a 0-20 skill level
	 * @param {number} moveCount
	 * @returns {Promise<{ from:number[], to:number[], promotion:string|null, engine:"stockfish"|"heuristic" }|null>}
	 */
	async getBestMove(board, turn, lastMove = null, difficulty = "medium", moveCount = 0) {
		const skillLevel = resolveSkillLevel(difficulty);
		const fen = boardToFEN(board, turn, moveCount);

		try {
			const uciMove = await askStockfish(fen, skillLevel);
			if (uciMove && uciMove !== "(none)") {
				const parsed = parseUciMove(uciMove);
				if (parsed) return { ...parsed, engine: "stockfish", skillLevel };
			}
		} catch (err) {
			console.warn(`[BotService] Stockfish unavailable (${err.message}), falling back to heuristic engine`);
		}

		const heuristicMove = pickHeuristicMove(board, turn, lastMove, skillLevel);
		if (!heuristicMove) return null;
		return { ...heuristicMove, engine: "heuristic", skillLevel };
	}
}

module.exports = new BotService();
module.exports.boardToFEN = boardToFEN;
module.exports.parseUciMove = parseUciMove;
module.exports.getLegalMoves = getLegalMoves;
module.exports.resolveSkillLevel = resolveSkillLevel;
