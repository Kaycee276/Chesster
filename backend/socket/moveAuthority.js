const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../middleware/authMiddleware");

/**
 * Verify a JWT presented over a socket connection.
 *
 * Mirrors the HTTP `requireAuth` middleware so socket and REST callers are held
 * to the same standard: a token must be a valid, unexpired JWT signed with the
 * server secret. Returns the decoded claims (`{ address, ... }`) on success or
 * `null` on any failure. Never throws.
 *
 * @param {string} token - Raw JWT string supplied by the client.
 * @returns {object|null} Decoded claims, or null if the token is missing/invalid.
 */
function verifySocketToken(token) {
	if (!token || typeof token !== "string") return null;
	try {
		const decoded = jwt.verify(token, JWT_SECRET);
		return { address: decoded.address || decoded.sub, ...decoded };
	} catch (err) {
		return null;
	}
}

/**
 * Resolve which player color a wallet address is entitled to in a game.
 *
 * The mapping is derived from server-owned game state, never from client input,
 * so a spectator or attacker cannot claim a color they do not own.
 *
 * @param {object} game - Game record with player_white_address/player_black_address.
 * @param {string} address - Authenticated wallet address.
 * @returns {"white"|"black"|null} The owned color, or null for a spectator.
 */
function resolvePlayerColor(game, address) {
	if (!game || !address) return null;
	if (game.player_white_address === address) return "white";
	if (game.player_black_address === address) return "black";
	return null;
}

/**
 * Server-authoritative gate for a move emitted over a socket.
 *
 * `socketColor` must be the color previously *verified* and bound to the socket
 * on join (null for spectators). This rejects socket injection and client-side
 * move spoofing: spectators cannot move, moves are refused unless the game is
 * active, and a player cannot move out of turn.
 *
 * @param {object} game - Current game record (with status and current_turn).
 * @param {"white"|"black"|null} socketColor - Verified color bound to the socket.
 * @returns {{ ok: boolean, code?: string, message?: string }}
 */
function authorizeMove(game, socketColor) {
	if (!game) {
		return { ok: false, code: "game-not-found", message: "Game not found" };
	}
	if (!socketColor) {
		return {
			ok: false,
			code: "not-a-player",
			message: "Only authenticated players of this game may make moves",
		};
	}
	if (game.status !== "active") {
		return { ok: false, code: "game-not-active", message: "Game is not active" };
	}
	if (game.current_turn !== socketColor) {
		return { ok: false, code: "not-your-turn", message: "It is not your turn" };
	}
	return { ok: true };
}

/**
 * Pure decision step for a socket disconnect during an active game (Issue #434).
 *
 * Returns whether an auto-forfeit grace timer should be started for the
 * player's seat, without starting it or touching any socket/io state itself,
 * so the caller (server.js) can start the timer atomically with its own
 * presence broadcast.
 *
 * @param {object} deps - { gameModel }
 * @param {string} gameCode
 * @param {"white"|"black"} playerColor
 * @returns {Promise<{ shouldStartGrace: boolean, game?: object }>}
 */
async function handleDisconnect(deps, gameCode, playerColor) {
	const { gameModel } = deps;
	if (!gameCode || !playerColor) return { shouldStartGrace: false };

	let game;
	try {
		game = await gameModel.getGame(gameCode);
	} catch (err) {
		return { shouldStartGrace: false };
	}

	if (!game || game.status !== "active") {
		return { shouldStartGrace: false, game };
	}

	return { shouldStartGrace: true, game };
}

/**
 * Pure reconnect-authorization step shared by the socket layer (Issue #434).
 *
 * Verifies the caller actually owns a seat in the game, cancels any pending
 * auto-forfeit grace timer for that seat (so it cannot race the reconnect and
 * forfeit a player who reconnected in time), and returns the resolved color.
 * Does not touch socket.io room membership or presence maps directly -- the
 * caller owns that state and performs the actual join/broadcast.
 *
 * @param {object} deps - { gameModel, timerService }
 * @param {string} gameCode
 * @param {string} walletAddress - Authenticated wallet address of the caller.
 * @returns {Promise<{ ok: boolean, code?: string, message?: string, game?: object, playerColor?: "white"|"black" }>}
 */
async function handleReconnect(deps, gameCode, walletAddress) {
	const { gameModel, timerService } = deps;

	let game;
	try {
		game = await gameModel.getGame(gameCode);
	} catch (err) {
		return { ok: false, code: "game-not-found", message: "Game not found" };
	}
	if (!game) {
		return { ok: false, code: "game-not-found", message: "Game not found" };
	}

	const playerColor = resolvePlayerColor(game, walletAddress);
	if (!playerColor) {
		return { ok: false, code: "not-a-player", message: "You are not part of this game" };
	}

	if (game.status !== "active") {
		return {
			ok: false,
			code: "game-not-active",
			message: `Cannot reconnect to ${game.status} game`,
		};
	}

	// Cancel the pending auto-forfeit grace timer now that the player is
	// provably back, before any further await lets it race against firing.
	timerService.cancelReconnectGrace(gameCode, playerColor);

	return { ok: true, game, playerColor };
}

/**
 * Assembles the authoritative state-reconciliation payload for a reconnecting
 * client (Issue #434): the moves it missed since `lastKnownMoveIndex`, the
 * live server clock (recomputed from server timestamps, never cached), and
 * enough match state for the client to resynchronize its local chess.js board
 * without waiting for the next `game-update` broadcast.
 *
 * `lastKnownMoveIndex` is compared against each move's `move_number`, the
 * same monotonic per-game sequence number already assigned when a move is
 * recorded, so no separate counter is needed to track "moveSeq".
 *
 * @param {object} deps - { gameController, timerService, chessEngine }
 * @param {string} gameCode
 * @param {number} lastKnownMoveIndex - Highest move_number the client has already applied (-1 = none).
 * @param {"white"|"black"|null} viewerColor - Used to mask variants like fog-of-war/blindfold.
 * @returns {Promise<object|null>} Reconciliation payload, or null if the game doesn't exist.
 */
async function reconcileGameState(deps, gameCode, lastKnownMoveIndex, viewerColor) {
	const { gameController, timerService, chessEngine } = deps;

	const snapshot = await gameController.getGameStateSnapshot(gameCode);
	if (!snapshot || !snapshot.game) return null;

	const { game, moves } = snapshot;
	const missedMoves = moves
		.filter((m) => m.move_number > lastKnownMoveIndex)
		.map((m) => ({
			moveSeq: m.move_number,
			from: m.from_position,
			to: m.to_position,
			piece: m.piece,
			promotion: m.promotion || null,
		}));

	const clocks = timerService.getPreciseClocks(gameCode);
	const isMasked = ["blindfold", "fog_of_war"].includes(game.variant || game.game_type);
	const fen =
		isMasked && viewerColor && chessEngine
			? chessEngine.generateFogOfWarFen(game.board_state, viewerColor, game.current_turn)
			: game.board_state;

	return {
		gameId: gameCode,
		fen,
		currentTurn: game.current_turn,
		status: game.status,
		lastMoveSeq: moves.length > 0 ? moves[moves.length - 1].move_number : -1,
		missedMoves,
		whiteTimeMs: clocks ? clocks.whiteMs : null,
		blackTimeMs: clocks ? clocks.blackMs : null,
		incrementMs: clocks ? clocks.incrementMs : null,
		drawOfferedBy: game.draw_offer || null,
		inCheck: game.in_check || false,
		lastMove: game.last_move || null,
	};
}

/**
 * WebSocket event emission helper for queue expansion updates (Issue #552).
 * Emits `QUEUE_EXPANDED` to the client when a matchmaking ticket's wait time
 * reaches an expansion threshold (15s, 30s, 45s).
 *
 * @param {object} io - Socket.io server instance or socket
 * @param {object} payload - { socketId, userId, ticketId, elapsedSeconds, searchRadius, thresholdSeconds }
 * @returns {boolean} true if emitted, false otherwise
 */
function emitQueueExpanded(io, payload) {
	if (!io || !payload) return false;
	const eventPayload = {
		userId: payload.userId,
		ticketId: payload.ticketId || null,
		elapsedSeconds: payload.elapsedSeconds,
		searchRadius: payload.searchRadius,
		thresholdSeconds: payload.thresholdSeconds,
		message: "Widening search parameters...",
	};

	if (payload.socketId && typeof io.to === "function") {
		io.to(payload.socketId).emit("QUEUE_EXPANDED", eventPayload);
		return true;
	} else if (typeof io.emit === "function") {
		io.emit("QUEUE_EXPANDED", eventPayload);
		return true;
	}
	return false;
}

/**
 * In-memory move submission timestamp tracking (Issue #553).
 * Captures the authoritative server timestamp (ms) per move submission.
 */
const moveSubmissionTimestamps = new Map();

/**
 * Record millisecond timestamp for a move submission.
 * @param {string} gameCode
 * @param {string} color
 * @param {number} [timestampMs=Date.now()]
 * @returns {number} recorded timestamp in ms
 */
function recordMoveSubmissionTimestamp(gameCode, color, timestampMs = Date.now()) {
	if (!gameCode || !color) return timestampMs;
	const key = `${gameCode}:${color}`;
	if (!moveSubmissionTimestamps.has(key)) {
		moveSubmissionTimestamps.set(key, []);
	}
	const timestamps = moveSubmissionTimestamps.get(key);
	timestamps.push(timestampMs);
	return timestampMs;
}

/**
 * Retrieve recorded move submission timestamps.
 * @param {string} gameCode
 * @param {string} color
 * @returns {Array<number>}
 */
function getMoveSubmissionTimestamps(gameCode, color) {
	const key = `${gameCode}:${color}`;
	return moveSubmissionTimestamps.get(key) || [];
}

/**
 * Clear recorded timestamps for a game.
 * @param {string} gameCode
 */
function clearMoveSubmissionTimestamps(gameCode) {
	if (!gameCode) return;
	for (const key of moveSubmissionTimestamps.keys()) {
		if (key.startsWith(`${gameCode}:`)) {
			moveSubmissionTimestamps.delete(key);
		}
	}
}

module.exports = {
	verifySocketToken,
	resolvePlayerColor,
	authorizeMove,
	handleDisconnect,
	handleReconnect,
	reconcileGameState,
	emitQueueExpanded,
	recordMoveSubmissionTimestamp,
	getMoveSubmissionTimestamps,
	clearMoveSubmissionTimestamps,
};
