const chessEngine = require("./chessEngine");
const { boardToFEN } = require("./botService");

/**
 * Game replay helpers for the SSE stream endpoint (Issue #245).
 *
 * Turns a game's stored move history into delta "frames" — one per move,
 * with the move, captured piece, clock state and resulting FEN — and
 * formats them as Server-Sent Events.
 */

const MIN_SPEED = 1;
const MAX_SPEED = 10;
// Long thinks are compressed during playback so a replay never sits idle
// for minutes; applied before the speed multiplier.
const MAX_MOVE_DELAY_MS = 10000;

/**
 * Parse the `speed` query parameter. Missing -> 1x; numeric values are
 * clamped to [MIN_SPEED, MAX_SPEED]; anything non-numeric -> null.
 */
function parseSpeed(raw) {
	if (raw === undefined || raw === null || raw === "") return MIN_SPEED;
	const speed = Number(String(raw).trim().replace(/x$/i, ""));
	if (!Number.isFinite(speed)) return null;
	return Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed));
}

/** How long to wait before emitting a move, given its original duration. */
function replayDelayMs(durationMs, speed) {
	const original = Math.min(Math.max(0, durationMs || 0), MAX_MOVE_DELAY_MS);
	return Math.round(original / speed);
}

function toMs(value) {
	if (!value) return null;
	const ms = Date.parse(value);
	return Number.isNaN(ms) ? null : ms;
}

function squareName(pos) {
	if (!Array.isArray(pos) || pos.length !== 2) return null;
	return `${String.fromCharCode(97 + pos[1])}${8 - pos[0]}`;
}

function isWhitePiece(piece) {
	return piece !== "." && piece === piece.toUpperCase();
}

/**
 * The opponent piece that disappeared between two positions, if any.
 * Diffing piece counts (rather than looking at the target square) also
 * catches en-passant captures, where the target square was empty.
 */
function capturedPiece(before, after, moverColor) {
	const counts = (board) => {
		const tally = {};
		for (const row of board) {
			for (const piece of row) {
				if (piece === "." || isWhitePiece(piece) === (moverColor === "white")) continue;
				tally[piece] = (tally[piece] || 0) + 1;
			}
		}
		return tally;
	};
	const was = counts(before);
	const now = counts(after);
	return Object.keys(was).find((piece) => (now[piece] || 0) < was[piece]) || null;
}

/**
 * Build one frame per move, in move order.
 * @param {object} game - games row (time control, start time)
 * @param {object[]} moves - moves rows for the game
 */
function buildReplayFrames(game, moves) {
	const ordered = [...moves].sort((a, b) => a.move_number - b.move_number);
	const baseMs = Number(game.time_control_seconds) > 0 ? Number(game.time_control_seconds) * 1000 : null;
	const incrementMs = (Number(game.time_increment_seconds) || 0) * 1000;
	const clock = baseMs === null ? null : { white: baseMs, black: baseMs };

	let board = chessEngine.initBoard();
	let previousAt = toMs(game.game_started_at);

	return ordered.map((move, index) => {
		const playedAtMs = toMs(move.created_at);
		const durationMs = playedAtMs !== null && previousAt !== null ? Math.max(0, playedAtMs - previousAt) : 0;
		if (playedAtMs !== null) previousAt = playedAtMs;

		const after = Array.isArray(move.board_state_after) ? move.board_state_after : board;
		const captured = capturedPiece(board, after, move.player);
		board = after;

		if (clock) {
			clock[move.player] = Math.max(0, clock[move.player] - durationMs) + incrementMs;
		}

		const from = squareName(move.from_position);
		const to = squareName(move.to_position);
		const nextTurn = move.player === "white" ? "black" : "white";

		return {
			index: index + 1,
			moveNumber: move.move_number,
			player: move.player,
			from: move.from_position,
			to: move.to_position,
			uci: from && to ? `${from}${to}${move.promotion ? String(move.promotion).toLowerCase() : ""}` : null,
			piece: move.piece,
			promotion: move.promotion || null,
			captured,
			isCheck: Boolean(move.is_check),
			isCheckmate: Boolean(move.is_checkmate),
			fen: boardToFEN(after, nextTurn, index + 1),
			clock: clock ? { whiteMs: clock.white, blackMs: clock.black } : null,
			durationMs,
			playedAt: playedAtMs === null ? null : new Date(playedAtMs).toISOString(),
		};
	});
}

/** Serialise one Server-Sent Event. `data` is JSON on a single line. */
function formatSSE({ event, id, data }) {
	let chunk = "";
	if (id !== undefined && id !== null) chunk += `id: ${id}\n`;
	if (event) chunk += `event: ${event}\n`;
	chunk += `data: ${JSON.stringify(data)}\n\n`;
	return chunk;
}

// ---------------------------------------------------------------------------
// Annotated PGN export (Issue #463)
//
// Emits standard PGN with per-move `[%clk H:MM:SS]` remaining-clock comments
// and optional `[%eval ...]` engine scores, in the inline-comment format used
// by Lichess, Chess.com and ChessBase:
//   1. e4 { [%clk 0:02:58] } 1... c5 { [%clk 0:02:57] }
// ---------------------------------------------------------------------------

const PGN_ANNOTATOR = "Chesster";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `[%clk H:MM:SS]` for a remaining clock in seconds (fractions truncated). */
function formatClockComment(remainingSeconds) {
	const seconds = Number(remainingSeconds);
	if (remainingSeconds === null || remainingSeconds === undefined || !Number.isFinite(seconds)) return null;
	const total = Math.max(0, Math.floor(seconds));
	const h = Math.floor(total / 3600);
	const mm = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
	const ss = String(total % 60).padStart(2, "0");
	return `[%clk ${h}:${mm}:${ss}]`;
}

function firstFinite(...values) {
	for (const value of values) {
		if (value === null || value === undefined || value === "") continue;
		const number = Number(value);
		if (Number.isFinite(number)) return number;
	}
	return null;
}

/**
 * `[%eval ...]` from a move row. Accepts a pawn-unit score (`evalScore`),
 * centipawns (`evaluation_cp` / `centipawns`) or a forced mate distance
 * (`mateIn`, positive = white mates). Returns null when no score is stored.
 */
function formatEvalComment(move = {}) {
	const mate = firstFinite(move.mateIn, move.mate_in);
	if (mate !== null) return `[%eval #${Math.trunc(mate)}]`;
	const pawns = firstFinite(move.evalScore, move.eval_score);
	const centipawns = firstFinite(move.evaluationCp, move.evaluation_cp, move.eval_cp, move.centipawns);
	const score = pawns !== null ? pawns : centipawns !== null ? centipawns / 100 : null;
	if (score === null) return null;
	return `[%eval ${score.toFixed(2)}]`;
}

/** PGN TimeControl tag: "base+increment" in seconds, "-" when untimed. */
function formatTimeControl(game = {}) {
	const base = Number(game.time_control_seconds);
	if (!Number.isFinite(base) || base <= 0) return "-";
	const increment = Number(game.time_increment_seconds) || 0;
	return `${base}+${increment}`;
}

function pgnResult(game = {}) {
	const winner = game.winner;
	if (winner === "draw" || game.is_draw === true) return "1/2-1/2";
	if (winner === "white" || (winner && winner === game.player_white_address)) return "1-0";
	if (winner === "black" || (winner && winner === game.player_black_address)) return "0-1";
	return "*";
}

/** Maps Chesster end reasons onto the PGN standard Termination values. */
function pgnTermination(game = {}) {
	if (game.status && game.status !== "finished" && game.status !== "completed") return "unterminated";
	const reason = String(game.end_reason || "").toLowerCase();
	if (["time", "timeout", "flag", "flag_fall", "time_forfeit"].includes(reason)) return "time forfeit";
	if (["disconnect", "abandonment", "abandoned"].includes(reason)) return "abandoned";
	return "normal";
}

function pgnDate(value) {
	const ms = toMs(value);
	return ms === null ? "????.??.??" : new Date(ms).toISOString().slice(0, 10).replaceAll("-", ".");
}

function escapeTag(value) {
	return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function isOwnPiece(piece, color) {
	return piece !== "." && isWhitePiece(piece) === (color === "white");
}

/** Board after a move, for rows stored without board_state_after. */
function applyStoredMove(board, from, to, promotion) {
	const piece = board[from[0]][from[1]].toLowerCase();
	const isEnPassant = piece === "p" && from[1] !== to[1] && board[to[0]][to[1]] === ".";
	const after = chessEngine.makeMove(board, from, to, promotion || null, isEnPassant);
	if (piece === "k" && Math.abs(to[1] - from[1]) === 2) {
		const [rookFrom, rookTo] = to[1] > from[1] ? [7, 5] : [0, 3];
		after[from[0]][rookTo] = after[from[0]][rookFrom];
		after[from[0]][rookFrom] = ".";
	}
	return after;
}

/** Standard Algebraic Notation for a stored move, with check suffixes. */
function moveToSan(board, move, after) {
	const from = move.from_position || move.from;
	const to = move.to_position || move.to;
	const color = move.player;
	const piece = board[from[0]][from[1]];
	const kind = piece.toLowerCase();
	const target = board[to[0]][to[1]];
	const toSquare = squareName(to);
	let san;

	if (kind === "k" && Math.abs(to[1] - from[1]) === 2) {
		san = to[1] > from[1] ? "O-O" : "O-O-O";
	} else if (kind === "p") {
		// A diagonal pawn move onto an empty square is an en-passant capture.
		const isCapture = target !== "." || from[1] !== to[1];
		san = `${isCapture ? `${squareName(from)[0]}x` : ""}${toSquare}`;
		if (move.promotion) san += `=${String(move.promotion).toUpperCase()}`;
	} else {
		let disambiguation = "";
		const rivals = [];
		for (let r = 0; r < 8; r += 1) {
			for (let c = 0; c < 8; c += 1) {
				if ((r === from[0] && c === from[1]) || board[r][c] !== piece) continue;
				if (chessEngine.isValidMove(board, [r, c], to, color).valid) rivals.push([r, c]);
			}
		}
		if (rivals.length > 0) {
			const fromSquare = squareName(from);
			if (!rivals.some(([, c]) => c === from[1])) disambiguation = fromSquare[0];
			else if (!rivals.some(([r]) => r === from[0])) disambiguation = fromSquare[1];
			else disambiguation = fromSquare;
		}
		san = `${kind.toUpperCase()}${disambiguation}${target !== "." ? "x" : ""}${toSquare}`;
	}

	const opponent = color === "white" ? "black" : "white";
	if (move.is_checkmate || chessEngine.isCheckmate(after, opponent)) return `${san}#`;
	if (move.is_check || chessEngine.isKingInCheck(after, opponent)) return `${san}+`;
	return san;
}

/**
 * Format a game and its stored moves as annotated PGN.
 * @param {object} game - games row
 * @param {object[]} moves - moves rows (any order)
 * @param {object} [options]
 * @param {{white?: number|null, black?: number|null}} [options.ratings] - pre-game Elo
 * @param {string} [options.event] - Event tag override
 * @param {string} [options.round] - Round tag override
 */
function formatPgn(game, moves = [], { ratings = {}, event, round } = {}) {
	const ordered = [...moves].sort((a, b) => a.move_number - b.move_number);
	const frames = buildReplayFrames(game, ordered);
	const clockEnabled = Number(game.time_control_seconds) > 0;
	const result = pgnResult(game);

	const headers = [
		["Event", event || "Chesster Game"],
		["Site", "Chesster"],
		["Date", pgnDate(game.game_started_at || game.created_at)],
		["Round", round || "-"],
		["White", game.player_white_address || "?"],
		["Black", game.player_black_address || "?"],
		["Result", result],
		["WhiteElo", Number.isFinite(ratings.white) ? ratings.white : "?"],
		["BlackElo", Number.isFinite(ratings.black) ? ratings.black : "?"],
		["TimeControl", formatTimeControl(game)],
		["Termination", pgnTermination(game)],
		["Annotator", PGN_ANNOTATOR],
	];
	const txId = game.escrow_tx_hash || game.escrow_resolve_tx;
	if (txId) headers.push(["StellarTransactionId", txId]);

	let board = chessEngine.initBoard();
	let previousHadComment = false;
	const tokens = [];

	ordered.forEach((move, index) => {
		const from = move.from_position || move.from;
		const to = move.to_position || move.to;
		const after = Array.isArray(move.board_state_after) ? move.board_state_after : applyStoredMove(board, from, to, move.promotion);
		const san = moveToSan(board, move, after);
		board = after;

		const moveNumber = Math.floor(index / 2) + 1;
		if (move.player === "white") tokens.push(`${moveNumber}.`);
		else if (index === 0 || previousHadComment) tokens.push(`${moveNumber}...`);
		tokens.push(san);

		const annotations = [];
		const evalComment = formatEvalComment(move);
		if (evalComment) annotations.push(evalComment);
		if (clockEnabled) {
			const storedMs = firstFinite(move.clockRemainingMs, move.clock_remaining_ms);
			const remainingMs = storedMs !== null ? storedMs : frames[index].clock?.[`${move.player}Ms`];
			const clockComment = formatClockComment(remainingMs / 1000);
			if (clockComment) annotations.push(clockComment);
		}
		previousHadComment = annotations.length > 0;
		if (previousHadComment) tokens.push(`{ ${annotations.join(" ")} }`);
	});
	tokens.push(result);

	const tagText = headers.map(([name, value]) => `[${name} "${escapeTag(value)}"]`).join("\n");
	return `${tagText}\n\n${tokens.join(" ")}\n`;
}

/**
 * Pre-game Elo for both players: the rating recorded in
 * player_rating_history for this game, falling back to the current
 * players.elo_rating. Lookup failures degrade to null ("?" in the PGN).
 */
async function fetchPlayerRatings(game, db = require("../config/supabase")) {
	const ratings = { white: null, black: null };
	for (const color of ["white", "black"]) {
		const address = game?.[`player_${color}_address`];
		if (!address) continue;
		try {
			if (game.id) {
				const { data: history, error } = await db
					.from("player_rating_history")
					.select("old_rating")
					.eq("game_id", game.id)
					.eq("wallet_address", address)
					.limit(1);
				if (error) throw error;
				const oldRating = firstFinite(history?.[0]?.old_rating);
				if (oldRating !== null) {
					ratings[color] = oldRating;
					continue;
				}
			}
			const { data: player, error } = await db
				.from("players")
				.select("elo_rating")
				.eq("wallet_address", address)
				.maybeSingle();
			if (error) throw error;
			ratings[color] = firstFinite(player?.elo_rating);
		} catch (error) {
			console.warn(`[Replay] rating lookup failed for ${color}: ${error.message}`);
		}
	}
	return ratings;
}

/**
 * Generate an annotated PGN for a game by id (UUID) or game code.
 * @returns {Promise<string>}
 */
async function generatePgn(gameId, db = require("../config/supabase")) {
	const column = UUID_PATTERN.test(String(gameId)) ? "id" : "game_code";
	const { data: game, error: gameError } = await db
		.from("games")
		.select("*")
		.eq(column, gameId)
		.maybeSingle();
	if (gameError) throw gameError;
	if (!game) {
		const error = new Error("Game not found");
		error.statusCode = 404;
		throw error;
	}

	const { data: moves, error: movesError } = await db
		.from("moves")
		.select("*")
		.eq("game_id", game.id)
		.order("move_number", { ascending: true });
	if (movesError) throw movesError;

	const ratings = await fetchPlayerRatings(game, db);
	return formatPgn(game, moves || [], { ratings });
}

/** Build a multi-game PGN for completed tournament bracket games. */
async function generateTournamentPgnArchive(tournamentId, db = require("../config/supabase")) {
	const { data: matches, error: matchError } = await db
		.from("bracket_matches")
		.select("*")
		.eq("tournament_id", tournamentId)
		.eq("status", "completed")
		.order("round", { ascending: true })
		.order("match_number", { ascending: true });
	if (matchError) throw matchError;

	const games = [];
	const orderedMatches = [...(matches || [])].sort((a, b) => a.round - b.round || a.match_number - b.match_number);
	for (const match of orderedMatches) {
		if (!match.game_code) continue;
		const { data: game, error: gameError } = await db
			.from("games")
			.select("*")
			.eq("game_code", match.game_code)
			.maybeSingle();
		if (gameError) throw gameError;
		if (!game || game.status !== "finished") continue;

		const { data: moves, error: movesError } = await db
			.from("moves")
			.select("*")
			.eq("game_id", game.id)
			.order("move_number", { ascending: true });
		if (movesError) throw movesError;

		const result = game.winner === "white" ? "1-0" : game.winner === "black" ? "0-1" : game.winner === "draw" ? "1/2-1/2" : "*";
		games.push(chessEngine.generateRichPgn(moves || [], {
			event: `Tournament #${tournamentId}`,
			round: `${match.round}.${match.match_number}`,
			white: game.player_white_address || match.player_white || match.player_one || "?",
			black: game.player_black_address || match.player_black || match.player_two || "?",
			result,
			createdAt: game.created_at,
			timeControl: game.time_control_seconds ? String(game.time_control_seconds) : "-",
		}));
	}
	return games.join("\n\n");
}

module.exports = {
	MIN_SPEED,
	MAX_SPEED,
	MAX_MOVE_DELAY_MS,
	parseSpeed,
	replayDelayMs,
	capturedPiece,
	buildReplayFrames,
	formatSSE,
	generateTournamentPgnArchive,
	PGN_ANNOTATOR,
	formatClockComment,
	formatEvalComment,
	formatTimeControl,
	pgnTermination,
	moveToSan,
	formatPgn,
	fetchPlayerRatings,
	generatePgn,
};
