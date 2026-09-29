const crypto = require("crypto");
const supabase = require("../config/supabase");
const { boardToFEN } = require("./botService");
const { JWT_SECRET } = require("../middleware/authMiddleware");

/**
 * Match audit exporter (Issue #243).
 *
 * Compiles everything an arbiter needs to rule on a disputed match into a
 * single package: the game outcome, every move with server receive time,
 * client timestamp, latency and FEN snapshot, the raw audit events recorded
 * in `match_audit_logs` (socket disconnects, coordinator transactions, ...),
 * and an HMAC signature over the outcome so the package can't be edited
 * after export without detection.
 */

const AUDIT_SCHEMA_VERSION = 1;
const SIGNATURE_ALGORITHM = "HMAC-SHA256";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Raw client IPs must never leave the server; they are exported as hashes.
const RAW_IP_KEYS = ["ip", "ip_address", "ipAddress", "client_ip", "clientIp", "remote_address", "remoteAddress"];
const DISCONNECT_EVENT_PATTERN = /disconnect/i;

/**
 * Signing key for audit packages. AUDIT_SIGNING_SECRET should be set in
 * production; otherwise a key is derived from JWT_SECRET so the audit
 * signature never reuses the token-signing key directly.
 */
function signingKey() {
	if (process.env.AUDIT_SIGNING_SECRET) return process.env.AUDIT_SIGNING_SECRET;
	return crypto.createHmac("sha256", JWT_SECRET).update("chesster-match-audit-v1").digest("hex");
}

/** JSON.stringify with recursively sorted object keys, so hashes are stable. */
function canonicalJson(value) {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (value && typeof value === "object") {
		return `{${Object.keys(value)
			.sort()
			.filter((key) => value[key] !== undefined)
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value === undefined ? null : value);
}

function sha256(text) {
	return crypto.createHash("sha256").update(text).digest("hex");
}

function hmac(text) {
	return crypto.createHmac("sha256", signingKey()).update(text).digest("hex");
}

function hashIp(ip) {
	return hmac(`ip:${ip}`);
}

function toIso(value) {
	if (value === null || value === undefined || value === "") return null;
	const date = typeof value === "number" ? new Date(value) : new Date(String(value));
	return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toMs(value) {
	const iso = toIso(value);
	return iso ? Date.parse(iso) : null;
}

/** Read the first present key from an event payload (snake_case or camelCase). */
function pick(data, ...keys) {
	for (const key of keys) {
		if (data && data[key] !== undefined && data[key] !== null) return data[key];
	}
	return null;
}

function toNumberOrNull(value) {
	const n = Number(value);
	return value === null || value === undefined || value === "" || !Number.isFinite(n) ? null : n;
}

function squareName(pos) {
	if (!Array.isArray(pos) || pos.length !== 2) return null;
	const [row, col] = pos;
	return `${String.fromCharCode(97 + col)}${8 - row}`;
}

function uciFor(move) {
	const from = squareName(move.from_position);
	const to = squareName(move.to_position);
	if (!from || !to) return null;
	return `${from}${to}${move.promotion ? String(move.promotion).toLowerCase() : ""}`;
}

function opposite(color) {
	return color === "white" ? "black" : "white";
}

/** Look a game up by UUID primary key or by its public game code. */
async function getGame(idOrCode) {
	const column = UUID_PATTERN.test(idOrCode) ? "id" : "game_code";
	const { data, error } = await supabase.from("games").select("*").eq(column, idOrCode).maybeSingle();
	if (error) throw new Error(error.message);
	return data || null;
}

async function getMoves(gameId) {
	const { data, error } = await supabase
		.from("moves")
		.select("*")
		.eq("game_id", gameId)
		.order("move_number", { ascending: true });
	if (error) throw new Error(error.message);
	return data || [];
}

async function getAuditLogs(gameId) {
	const { data, error } = await supabase
		.from("match_audit_logs")
		.select("*")
		.eq("game_id", gameId)
		.order("created_at", { ascending: true });
	if (error) throw new Error(error.message);
	return data || [];
}

function adminAddresses() {
	return (process.env.ADMIN_ADDRESSES || "")
		.split(",")
		.map((address) => address.trim())
		.filter(Boolean);
}

function isAdmin(user) {
	if (!user) return false;
	if (user.role === "admin") return true;
	return Boolean(user.address) && adminAddresses().includes(user.address);
}

/**
 * Only the two players of a match and platform admins may export its
 * audit trail — it contains the opponent's network telemetry.
 */
function canAccessAudit(user, game) {
	if (!user || !game) return false;
	if (isAdmin(user)) return true;
	return Boolean(user.address) && [game.player_white_address, game.player_black_address].includes(user.address);
}

/** Normalise one match_audit_logs row, hashing any raw client IP. */
function buildEvent(log, index) {
	const data = { ...(log.event_data || {}) };
	const rawIp = pick(data, ...RAW_IP_KEYS);
	for (const key of RAW_IP_KEYS) delete data[key];

	const existingHash = pick(data, "ip_hash", "client_ip_hash", "clientIpHash");
	const clientIpHash = existingHash || (rawIp ? hashIp(String(rawIp)) : null);

	return {
		sequence: index + 1,
		id: log.id,
		eventType: log.event_type,
		playerAddress: log.player_address || null,
		serverReceivedAt: toIso(log.created_at),
		clientTimestamp: toIso(pick(data, "client_timestamp", "clientTimestamp")),
		clientPingMs: toNumberOrNull(pick(data, "client_ping_ms", "clientPingMs", "ping_ms")),
		clientIpHash,
		coordinatorTxHash: log.coordinator_tx_hash || null,
		data,
	};
}

/** Index move telemetry events by the move number they describe. */
function moveTelemetryByNumber(events) {
	const byNumber = new Map();
	for (const event of events) {
		const moveNumber = toNumberOrNull(pick(event.data, "move_number", "moveNumber", "sequence_number", "sequenceNumber"));
		if (moveNumber !== null && !byNumber.has(moveNumber)) byNumber.set(moveNumber, event);
	}
	return byNumber;
}

function buildMoves(game, moves, events) {
	const telemetry = moveTelemetryByNumber(events);
	let previousAt = toMs(game.game_started_at);

	return moves.map((move, index) => {
		const serverAt = toMs(move.created_at);
		const event = telemetry.get(move.move_number) || null;
		const clientAt = event ? toMs(event.clientTimestamp) : null;
		const fenAfter = Array.isArray(move.board_state_after)
			? boardToFEN(move.board_state_after, opposite(move.player), move.move_number)
			: (event && pick(event.data, "fen_after", "fenAfter")) || null;

		const record = {
			sequence: index + 1,
			moveNumber: move.move_number,
			player: move.player,
			from: move.from_position,
			to: move.to_position,
			uci: uciFor(move),
			piece: move.piece,
			promotion: move.promotion || null,
			isCheck: Boolean(move.is_check),
			isCheckmate: Boolean(move.is_checkmate),
			serverReceivedAt: toIso(move.created_at),
			clientTimestamp: clientAt === null ? null : new Date(clientAt).toISOString(),
			moveLatencyMs: serverAt !== null && clientAt !== null ? serverAt - clientAt : null,
			clientPingMs: event ? event.clientPingMs : null,
			thinkTimeMs: serverAt !== null && previousAt !== null ? serverAt - previousAt : null,
			fenAfter,
		};
		if (serverAt !== null) previousAt = serverAt;
		return record;
	});
}

/** The signed statement of how the match ended. */
function buildOutcome(match, escrow, moves, events) {
	return {
		gameId: match.gameId,
		gameCode: match.gameCode,
		status: match.status,
		winner: match.winner,
		endReason: match.endReason,
		players: match.players,
		wagerAmount: match.wagerAmount,
		resolvedAt: match.resolvedAt,
		finalFen: match.finalFen,
		moveCount: moves.length,
		escrowResolveTxHash: escrow.resolveTxHash,
		movesDigest: sha256(canonicalJson(moves)),
		eventsDigest: sha256(canonicalJson(events)),
	};
}

function signOutcome(outcome) {
	const outcomeHash = sha256(canonicalJson(outcome));
	return { outcomeHash, signature: hmac(outcomeHash) };
}

/**
 * Compile the full audit package for an already-loaded game row.
 * Moves are ordered by move number and events chronologically.
 */
async function buildAuditPackage(game) {
	const [moveRows, logRows] = await Promise.all([getMoves(game.id), getAuditLogs(game.id)]);

	const events = logRows
		.slice()
		.sort((a, b) => (toMs(a.created_at) ?? 0) - (toMs(b.created_at) ?? 0))
		.map(buildEvent);
	const moves = buildMoves(game, moveRows, events);
	const finished = game.status === "finished";

	const match = {
		gameId: game.id,
		gameCode: game.game_code,
		gameType: game.game_type || "chess",
		status: game.status,
		winner: game.winner || null,
		endReason: game.end_reason || null,
		players: { white: game.player_white_address || null, black: game.player_black_address || null },
		wagerAmount: game.wager_amount ?? null,
		timeControl: {
			preset: game.time_control_preset || null,
			baseSeconds: game.time_control_seconds ?? null,
			incrementSeconds: game.time_increment_seconds ?? null,
		},
		createdAt: toIso(game.created_at),
		startedAt: toIso(game.game_started_at),
		resolvedAt: finished ? toIso(game.updated_at) : null,
		finalFen: Array.isArray(game.board_state) ? boardToFEN(game.board_state, game.current_turn, moves.length) : null,
	};

	const escrow = {
		status: game.escrow_status || null,
		createTxHash: game.escrow_create_tx || null,
		joinTxHash: game.escrow_join_tx || null,
		resolveTxHash: game.escrow_resolve_tx || null,
	};

	const outcome = buildOutcome(match, escrow, moves, events);
	const { outcomeHash, signature } = signOutcome(outcome);

	return {
		schemaVersion: AUDIT_SCHEMA_VERSION,
		generatedAt: new Date().toISOString(),
		match,
		escrow,
		summary: {
			totalMoves: moves.length,
			totalEvents: events.length,
			disconnectEvents: events.filter((e) => DISCONNECT_EVENT_PATTERN.test(e.eventType)).length,
			coordinatorTransactions: events.filter((e) => e.coordinatorTxHash).length,
		},
		moves,
		events,
		integrity: {
			algorithm: SIGNATURE_ALGORITHM,
			outcome,
			outcomeHash,
			signature,
		},
	};
}

/** Convenience: resolve the game and compile its package (null when missing). */
async function exportMatchAudit(idOrCode) {
	const game = await getGame(idOrCode);
	if (!game) return null;
	return buildAuditPackage(game);
}

/**
 * Check that a package's moves/events still match its signed outcome and
 * that the signature was produced with this server's key.
 */
function verifyAuditPackage(pkg) {
	if (!pkg || !pkg.integrity || !pkg.integrity.outcome) return false;
	const { outcome, outcomeHash, signature } = pkg.integrity;
	if (outcome.movesDigest !== sha256(canonicalJson(pkg.moves))) return false;
	if (outcome.eventsDigest !== sha256(canonicalJson(pkg.events))) return false;
	if (outcomeHash !== sha256(canonicalJson(outcome))) return false;

	const expected = Buffer.from(hmac(outcomeHash), "hex");
	const actual = Buffer.from(String(signature), "hex");
	return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

const CSV_COLUMNS = [
	"sequence",
	"kind",
	"timestamp",
	"player",
	"event_type",
	"move_number",
	"uci",
	"piece",
	"client_timestamp",
	"move_latency_ms",
	"client_ping_ms",
	"think_time_ms",
	"client_ip_hash",
	"coordinator_tx_hash",
	"fen_after",
];

/** Quote a CSV cell and neutralise spreadsheet formula injection. */
function csvCell(value) {
	if (value === null || value === undefined) return "";
	let text = typeof value === "object" ? JSON.stringify(value) : String(value);
	if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
	return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Flatten a package into one chronological CSV timeline of moves and
 * events. Integrity data travels in response headers (see controller).
 */
function toCsv(pkg) {
	const rows = [
		...pkg.moves.map((m) => ({
			at: m.serverReceivedAt,
			order: 0,
			cells: {
				kind: "move",
				timestamp: m.serverReceivedAt,
				player: m.player,
				event_type: "move",
				move_number: m.moveNumber,
				uci: m.uci,
				piece: m.piece,
				client_timestamp: m.clientTimestamp,
				move_latency_ms: m.moveLatencyMs,
				client_ping_ms: m.clientPingMs,
				think_time_ms: m.thinkTimeMs,
				fen_after: m.fenAfter,
			},
		})),
		...pkg.events.map((e) => ({
			at: e.serverReceivedAt,
			order: 1,
			cells: {
				kind: "event",
				timestamp: e.serverReceivedAt,
				player: e.playerAddress,
				event_type: e.eventType,
				client_timestamp: e.clientTimestamp,
				client_ping_ms: e.clientPingMs,
				client_ip_hash: e.clientIpHash,
				coordinator_tx_hash: e.coordinatorTxHash,
			},
		})),
	];

	// Stable chronological merge; moves sort before events at the same instant.
	rows.sort((a, b) => (toMs(a.at) ?? 0) - (toMs(b.at) ?? 0) || a.order - b.order);

	const lines = [CSV_COLUMNS.join(",")];
	rows.forEach((row, index) => {
		const cells = { ...row.cells, sequence: index + 1 };
		lines.push(CSV_COLUMNS.map((column) => csvCell(cells[column])).join(","));
	});
	return `${lines.join("\r\n")}\r\n`;
}

module.exports = {
	getGame,
	canAccessAudit,
	isAdmin,
	buildAuditPackage,
	exportMatchAudit,
	verifyAuditPackage,
	toCsv,
	hashIp,
	canonicalJson,
};
