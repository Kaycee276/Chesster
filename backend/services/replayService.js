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

module.exports = {
	MIN_SPEED,
	MAX_SPEED,
	MAX_MOVE_DELAY_MS,
	parseSpeed,
	replayDelayMs,
	capturedPiece,
	buildReplayFrames,
	formatSSE,
};
