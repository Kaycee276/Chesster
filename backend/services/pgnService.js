const { Readable } = require("stream");
const readline = require("readline");
const chessEngine = require("./chessEngine");

const DEFAULT_BATCH_SIZE = 50;

const HEADER_RE = /^\[(\w+)\s+"((?:[^"\\\x00-\x1f\x7f]|\\["\\])*)"\]$/;
const STR_TAGS = ["Event", "Site", "Date", "Round", "White", "Black", "Result"];
const RESULT_TOKENS = new Set(["1-0", "0-1", "1/2-1/2", "*"]);
// Comments, NAG glyphs, move-number markers, result tokens, or a bare
// movetext token (candidate SAN), scanned left to right so clock/NAG
// annotations can be attached to the move that precedes them.
const TOKEN_RE = /\{[^}]*\}|\$\d+|\d+\.(?:\.\.)?|1-0|0-1|1\/2-1\/2|\*|[^\s{}$]+/g;
const CLOCK_RE = /\[%clk\s+([0-9:]+)\]/;

function escapePgnTag(value) {
	return String(value).replace(/[\x00-\x1f\x7f]/g, " ").replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function isValidPgnDate(value) {
	if (!/^\d{4}\.\d{2}\.\d{2}$/.test(value)) return false;
	const iso = value.replaceAll(".", "-");
	const date = new Date(`${iso}T00:00:00.000Z`);
	return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === iso;
}

function getSevenTagRoster(game = {}) {
	const text = (value, fallback) => String(value ?? "").replace(/[\x00-\x1f\x7f]/g, " ").trim() || fallback;
	const rawDate = game.date ?? game.game_started_at ?? game.created_at ?? game.createdAt ?? Date.now();
	const date = new Date(typeof rawDate === "string" && isValidPgnDate(rawDate) ? rawDate.replaceAll(".", "-") : rawDate);
	const dateValue = Number.isNaN(date.valueOf()) || date.getUTCFullYear() < 0 || date.getUTCFullYear() > 9999
		? new Date() : date;
	const winner = game.winner;
	const result = RESULT_TOKENS.has(game.result) ? game.result
		: winner === "draw" || game.is_draw === true ? "1/2-1/2"
			: winner === "white" || (winner && winner === game.player_white_address) ? "1-0"
				: winner === "black" || (winner && winner === game.player_black_address) ? "0-1" : "*";
	return {
		Event: text(game.event, "Chesster Match"),
		Site: text(game.site, "https://chesster.app"),
		Date: dateValue.toISOString().slice(0, 10).replaceAll("-", "."),
		Round: text(game.round, "-"),
		White: text(game.white ?? game.player_white_address, "White"),
		Black: text(game.black ?? game.player_black_address, "Black"),
		Result: result,
	};
}

function formatSevenTagRoster(game = {}) {
	return Object.entries(getSevenTagRoster(game)).map(([tag, value]) => `[${tag} "${escapePgnTag(value)}"]`).join("\n");
}

/** Validate one game's initial header section, including order and tag values. */
function validateSevenTagRoster(pgn) {
	if (typeof pgn !== "string") return { isValid: false, missingTags: [...STR_TAGS] };
	const tags = [];
	let malformed = false;
	for (const rawLine of pgn.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line) continue;
		if (!line.startsWith("[")) break;
		const match = line.match(HEADER_RE);
		if (!match) { malformed = true; continue; }
		tags.push([match[1], match[2].replace(/\\(["\\])/g, "$1")]);
	}
	const missingTags = STR_TAGS.filter((name) => !tags.some(([tag]) => tag === name));
	const values = Object.fromEntries(tags);
	const ordered = STR_TAGS.every((name, index) => tags[index]?.[0] === name && tags.filter(([tag]) => tag === name).length === 1);
	const nonempty = STR_TAGS.every((name) => typeof values[name] === "string" && values[name].trim().length > 0);
	return {
		isValid: !malformed && missingTags.length === 0 && ordered && nonempty && isValidPgnDate(values.Date) && RESULT_TOKENS.has(values.Result),
		missingTags,
	};
}

/** Preserve the existing SAN, clock and engine annotations on database exports. */
function generateGamePGN(game, moves = [], options = {}) {
	return require("./replayService").formatPgn(game, moves, options);
}

function emptyGame() {
	return { headers: {}, headerLines: [], movesStr: "" };
}

/**
 * Strips recursive variation annotations `( ... )`, which may nest, so the
 * tokenizer only ever sees the mainline.
 */
function stripVariations(movesStr) {
	let depth = 0;
	let out = "";
	for (const char of movesStr) {
		if (char === "(") {
			depth += 1;
			continue;
		}
		if (char === ")") {
			if (depth > 0) depth -= 1;
			continue;
		}
		if (depth === 0) out += char;
	}
	return out;
}

/**
 * Tokenizes raw PGN movetext into an ordered list of SAN moves, attaching
 * any `[%clk ...]` annotation found in the comment immediately following a
 * move to that move. NAG glyphs and move-number markers are dropped; the
 * terminating result token (if present) is returned separately.
 */
function tokenizeMoveText(movesStr) {
	const withoutVariations = stripVariations(movesStr);
	const moves = [];
	let result = null;
	let match;

	TOKEN_RE.lastIndex = 0;
	while ((match = TOKEN_RE.exec(withoutVariations)) !== null) {
		const token = match[0];

		if (token.startsWith("{")) {
			const clockMatch = token.match(CLOCK_RE);
			if (clockMatch && moves.length > 0) {
				moves[moves.length - 1].clock = clockMatch[1];
			}
			continue;
		}
		if (token.startsWith("$")) continue; // NAG glyph
		if (/^\d+\.(\.\.)?$/.test(token)) continue; // move-number marker
		if (RESULT_TOKENS.has(token)) {
			result = token;
			continue;
		}

		moves.push({ san: token, clock: null });
	}

	return { moves, result };
}

/**
 * Replays tokenized SAN moves on a fresh board via the existing move
 * validator/applier in `chessEngine`, stopping at the first illegal move.
 */
function validateAndFormat(rawGame) {
	const headers = rawGame.headers;
	const { moves: sanMoves, result } = tokenizeMoveText(rawGame.movesStr);

	let board = chessEngine.initBoard();
	let color = "white";
	const moves = [];
	let error = null;
	const roster = validateSevenTagRoster(rawGame.headerLines?.join("\n") ?? Object.entries(headers).map(([tag, value]) => `[${tag} "${escapePgnTag(value)}"]`).join("\n"));
	if (!roster.isValid) error = { message: "Invalid Seven Tag Roster", missingTags: roster.missingTags };
	else if (result && result !== headers.Result) error = { message: "Movetext result does not match the Result tag" };

	for (let ply = 0; ply < sanMoves.length; ply++) {
		if (error) break;
		const { san, clock } = sanMoves[ply];
		const parsed = chessEngine.parseSanMove(san, board, color);

		if (!parsed.valid) {
			error = { ply: ply + 1, san, color, message: `Illegal or unrecognized move "${san}" for ${color}` };
			break;
		}

		board = chessEngine.makeMove(board, parsed.from, parsed.to, parsed.promotion);
		moves.push({ ply: ply + 1, color, san, from: parsed.from, to: parsed.to, promotion: parsed.promotion, clock });
		color = color === "white" ? "black" : "white";
	}

	return {
		headers,
		result: result || headers.Result || null,
		moves,
		finalBoard: board,
		nextTurn: color,
		valid: !error,
		error,
	};
}

/**
 * Streams a PGN source (a Readable or a raw string) and yields one
 * validated game record at a time, so multi-megabyte archives with
 * hundreds of games never need to be buffered or parsed in one pass.
 */
async function* parsePgnStream(input) {
	const stream = typeof input === "string" ? Readable.from([input]) : input;
	const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

	let current = emptyGame();
	let hasMoves = false;

	const hasContent = () => Object.keys(current.headers).length > 0 || hasMoves;

	for await (const rawLine of rl) {
		const line = rawLine.trim();

		if (line.startsWith("[")) {
			// A header line while a previous game's movetext is already being
			// collected (missing blank-line separator) starts a new game.
			if (hasMoves) {
				yield validateAndFormat(current);
				current = emptyGame();
				hasMoves = false;
			}
			const match = line.match(HEADER_RE);
			current.headerLines.push(line);
			if (match) current.headers[match[1]] = match[2].replace(/\\(["\\])/g, "$1");
			continue;
		}

		if (line.length === 0) {
			if (hasContent() && hasMoves) {
				yield validateAndFormat(current);
				current = emptyGame();
				hasMoves = false;
			}
			continue;
		}

		current.movesStr += " " + line;
		hasMoves = true;
	}

	if (hasContent()) yield validateAndFormat(current);
}

/**
 * Consumes a streamed PGN source end to end, batching valid games through
 * `persistBatch` (default chunk size 50) and collecting a per-game report
 * so malformed games are skipped without aborting the whole import.
 */
async function importPgn(input, { batchSize = DEFAULT_BATCH_SIZE, persistBatch } = {}) {
	const summary = { total: 0, imported: 0, skipped: 0, games: [] };
	let batch = [];

	for await (const game of parsePgnStream(input)) {
		summary.total += 1;
		summary.games.push({
			headers: game.headers,
			valid: game.valid,
			moveCount: game.moves.length,
			error: game.error,
		});

		if (!game.valid) {
			summary.skipped += 1;
			continue;
		}

		summary.imported += 1;
		batch.push(game);

		if (batch.length >= batchSize) {
			if (persistBatch) await persistBatch(batch);
			batch = [];
		}
	}

	if (batch.length > 0 && persistBatch) await persistBatch(batch);

	return summary;
}

function sanitizeFilenameSegment(str) {
	if (!str || typeof str !== 'string') return 'player';
	return str.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 24);
}

function generatePgnFilename(game = {}) {
	const white = sanitizeFilenameSegment(game.whitePlayer?.username || game.player_white_username || game.white || game.player_white_address || 'white');
	const black = sanitizeFilenameSegment(game.blackPlayer?.username || game.player_black_username || game.black || game.player_black_address || 'black');
	const rawDate = game.createdAt || game.created_at || game.game_started_at || game.date || Date.now();
	const date = new Date(rawDate);
	const dateStr = Number.isNaN(date.valueOf()) ? new Date().toISOString().slice(0, 10) : date.toISOString().slice(0, 10);
	return `chesster-${white}-vs-${black}-${dateStr}.pgn`;
}

function getPgnDownloadHeaders(game = {}) {
	const filename = generatePgnFilename(game);
	return {
		'Content-Type': 'application/x-chess-pgn; charset=utf-8',
		'Content-Disposition': `attachment; filename="${filename}"`,
	};
}

module.exports = {
	STR_TAGS,
	escapePgnTag,
	getSevenTagRoster,
	formatSevenTagRoster,
	validateSevenTagRoster,
	generateGamePGN,
	DEFAULT_BATCH_SIZE,
	parsePgnStream,
	tokenizeMoveText,
	validateAndFormat,
	importPgn,
	sanitizeFilenameSegment,
	generatePgnFilename,
	getPgnDownloadHeaders,
};
