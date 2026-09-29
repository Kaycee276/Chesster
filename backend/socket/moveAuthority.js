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

module.exports = { verifySocketToken, resolvePlayerColor, authorizeMove };
