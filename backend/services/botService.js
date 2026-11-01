const { parseUciMove, getLegalMoves, getOpeningBookMove } = require("./botHeuristics");
const { StockfishPool, PRIORITY, configuredPoolSize } = require("./stockfishPool");

// Path to a UCI-speaking Stockfish binary. Not bundled with this repo (the
// official `stockfish` npm package ships 100MB+ of prebuilt WASM binaries
// per platform, which is heavy for this project) — instead we shell out to
// whatever engine is available on the host, same as most self-hosted chess
// servers do. Set STOCKFISH_PATH to point at a real Stockfish executable in
// any environment where bots should actually play at engine strength.
const STOCKFISH_PATH = process.env.STOCKFISH_PATH || "stockfish";
const ENGINE_MOVE_TIME_MS = parseInt(process.env.STOCKFISH_MOVE_TIME_MS || "800", 10);
// Post-game analysis searches deeper than a live move, so it gets a longer
// execution budget and may wait longer for a worker behind live moves.
const ANALYSIS_TIMEOUT_MS = Number(process.env.STOCKFISH_ANALYSIS_TIMEOUT_MS) || 15000;
const ANALYSIS_QUEUE_TIMEOUT_MS = Number(process.env.STOCKFISH_ANALYSIS_QUEUE_TIMEOUT_MS) || 30000;

// Expected, steady-state fallback reasons that shouldn't be logged per move.
const QUIET_FALLBACK_REASONS = new Set(["engine unavailable", "no engine configured"]);

/**
 * Difficulty presets -> UCI "Skill Level" (0-20) and search depth.
 * Beginner / Intermediate / Master are the single-player bot tiers; the
 * older easy/medium/hard/maximum names are kept for existing clients.
 */
const DIFFICULTY_PRESETS = {
	beginner: { skillLevel: 1, depth: 3 },
	easy: { skillLevel: 2, depth: 5 },
	intermediate: { skillLevel: 8, depth: 8 },
	medium: { skillLevel: 10, depth: 10 },
	hard: { skillLevel: 18, depth: 16 },
	master: { skillLevel: 20, depth: 20 },
	maximum: { skillLevel: 20, depth: 22 },
};

/**
 * Chesster bot levels 1-8 (Beginner ~800 ELO to Grandmaster ~2500 ELO) ->
 * UCI "Skill Level" and search depth (Issue #437).
 */
const BOT_LEVELS = Object.freeze({
	1: { skillLevel: 0, depth: 1, elo: 800 },
	2: { skillLevel: 3, depth: 3, elo: 1000 },
	3: { skillLevel: 6, depth: 5, elo: 1200 },
	4: { skillLevel: 9, depth: 7, elo: 1400 },
	5: { skillLevel: 12, depth: 9, elo: 1700 },
	6: { skillLevel: 15, depth: 12, elo: 2000 },
	7: { skillLevel: 18, depth: 16, elo: 2250 },
	8: { skillLevel: 20, depth: 20, elo: 2500 },
});

function isValidBotLevel(level) {
	return Number.isInteger(level) && Object.prototype.hasOwnProperty.call(BOT_LEVELS, level);
}

/** Map a 0-20 skill level onto a search depth consistent with the presets. */
function depthForSkill(skillLevel) {
	return Math.max(1, Math.min(22, Math.round(3 + skillLevel * 0.9)));
}

/**
 * Resolve a difficulty (`{ level: 1-8 }`, preset name, case-insensitive, or
 * 0-20 skill level) into the engine parameters used for the search.
 * @returns {{ skillLevel: number, depth: number }}
 */
function resolveDifficulty(difficulty) {
	if (difficulty && typeof difficulty === "object" && isValidBotLevel(difficulty.level)) {
		const { skillLevel, depth } = BOT_LEVELS[difficulty.level];
		return { skillLevel, depth };
	}
	if (typeof difficulty === "number" && Number.isFinite(difficulty)) {
		const skillLevel = Math.max(0, Math.min(20, Math.round(difficulty)));
		return { skillLevel, depth: depthForSkill(skillLevel) };
	}
	if (typeof difficulty === "string") {
		const preset = DIFFICULTY_PRESETS[difficulty.trim().toLowerCase()];
		if (preset) return { ...preset };
	}
	return { ...DIFFICULTY_PRESETS.medium };
}

function resolveSkillLevel(difficulty) {
	return resolveDifficulty(difficulty).skillLevel;
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

class BotService {
	constructor(pool) {
		this._pool = pool || null;
	}

	/** The shared worker pool, created on first use. */
	get pool() {
		if (!this._pool) {
			this._pool = new StockfishPool({
				size: configuredPoolSize(),
				workerData: { enginePath: STOCKFISH_PATH },
			});
		}
		return this._pool;
	}

	/**
	 * Analyze a FEN at full strength and return Stockfish's top move and score.
	 * Runs in the shared pool at background priority, so post-game analysis
	 * never delays live bot moves or spawns engines outside the pool's cap.
	 * @returns {Promise<{ bestMove: string|null, scoreCp: number|null }>}
	 */
	analyzeFen(fen, depth = 16) {
		return this.pool.run(
			{ kind: "analyze", fen, depth: Math.max(1, Math.floor(depth)) },
			{ priority: PRIORITY.ANALYSIS, timeoutMs: ANALYSIS_TIMEOUT_MS, queueTimeoutMs: ANALYSIS_QUEUE_TIMEOUT_MS },
		);
	}

	/**
	 * Compute the bot's move for a single-player game. The search runs in a
	 * pooled worker thread (Stockfish when available, otherwise a heuristic
	 * picker) and is capped at BOT_MOVE_TIMEOUT_MS.
	 * @param {string[][]} board - internal board representation
	 * @param {"white"|"black"} turn - color the bot is playing
	 * @param {object|null} lastMove - { from, to, piece } of the last move (for en passant)
	 * @param {string|number|{level:number}} difficulty - `{ level: 1-8 }`, "beginner"|"intermediate"|"master"
	 *   (or legacy "easy"|"medium"|"hard"|"maximum"), or a 0-20 skill level
	 * @param {number} moveCount
	 * @returns {Promise<{ from:number[], to:number[], promotion:string|null, uci:string,
	 *   engine:"stockfish"|"heuristic", skillLevel:number, depth:number }|null>}
	 * @throws {Error} with code BOT_TIMEOUT or BOT_QUEUE_FULL when the pool can't answer in time
	 */
	async getBestMove(board, turn, lastMove = null, difficulty = "medium", moveCount = 0) {
		const { skillLevel, depth } = resolveDifficulty(difficulty);
		const fen = boardToFEN(board, turn, moveCount);
		if (moveCount < 12) {
			const bookMove = getOpeningBookMove(fen);
			if (bookMove) {
				const parsed = parseUciMove(bookMove);
				const legal = parsed && getLegalMoves(board, turn, lastMove)
					.some((move) => JSON.stringify(move.from) === JSON.stringify(parsed.from) && JSON.stringify(move.to) === JSON.stringify(parsed.to));
				if (legal) return { ...parsed, uci: bookMove, engine: "opening-book", skillLevel, depth };
			}
		}

		const result = await this.pool.executeMove({
			fen,
			board,
			turn,
			lastMove,
			skillLevel,
			depth,
			moveTimeMs: ENGINE_MOVE_TIME_MS,
		});

		if (result.fallbackReason && !QUIET_FALLBACK_REASONS.has(result.fallbackReason)) {
			console.warn(`[BotService] Stockfish unavailable (${result.fallbackReason}), falling back to heuristic engine`);
		}

		if (!result.move) return null;
		return { ...result.move, uci: result.uci, engine: result.engine, skillLevel, depth };
	}

	/** Terminate the worker pool (graceful shutdown / tests). */
	async shutdown() {
		if (this._pool) {
			const pool = this._pool;
			this._pool = null;
			await pool.destroy();
		}
	}
}

module.exports = new BotService();
module.exports.BotService = BotService;
module.exports.BOT_LEVELS = BOT_LEVELS;
module.exports.isValidBotLevel = isValidBotLevel;
module.exports.DIFFICULTY_PRESETS = DIFFICULTY_PRESETS;
module.exports.boardToFEN = boardToFEN;
module.exports.parseUciMove = parseUciMove;
module.exports.getOpeningBookMove = getOpeningBookMove;
module.exports.getLegalMoves = getLegalMoves;
module.exports.resolveDifficulty = resolveDifficulty;
module.exports.resolveSkillLevel = resolveSkillLevel;
