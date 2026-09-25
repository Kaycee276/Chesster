const chessEngine = require("../../services/chessEngine");

const GAME_ID = "7d4f5a8e-2b1c-4e6f-9a3d-1c2b3a4d5e6f";
const T0 = Date.parse("2026-03-01T12:00:00.000Z");
const at = (seconds) => new Date(T0 + seconds * 1000).toISOString();

function boardAfter(moves) {
	let board = chessEngine.initBoard();
	for (const [from, to] of moves) board = chessEngine.makeMove(board, from, to);
	return board;
}

const E2E4 = [[6, 4], [4, 4]];
const E7E5 = [[1, 4], [3, 4]];
const G1F3 = [[7, 6], [5, 5]];

/** A finished wager match with three moves and mixed audit telemetry. */
function auditFixture() {
	const boards = [boardAfter([E2E4]), boardAfter([E2E4, E7E5]), boardAfter([E2E4, E7E5, G1F3])];

	const game = {
		id: GAME_ID,
		game_code: "AUD123",
		game_type: "chess",
		status: "finished",
		winner: "white",
		end_reason: "resignation",
		player_white_address: "GWHITE",
		player_black_address: "GBLACK",
		wager_amount: 25,
		time_control_preset: "rapid",
		time_control_seconds: 600,
		time_increment_seconds: 0,
		board_state: boards[2],
		current_turn: "black",
		created_at: at(-60),
		game_started_at: at(0),
		updated_at: at(30),
		escrow_status: "settled",
		escrow_create_tx: "tx-create",
		escrow_join_tx: "tx-join",
		escrow_resolve_tx: "tx-resolve",
	};

	// Stored out of order on purpose: the exporter must sort them.
	const moves = [
		{ id: "m2", game_id: GAME_ID, move_number: 2, player: "black", from_position: E7E5[0], to_position: E7E5[1], piece: "p", board_state_after: boards[1], is_check: false, is_checkmate: false, promotion: null, created_at: at(12) },
		{ id: "m1", game_id: GAME_ID, move_number: 1, player: "white", from_position: E2E4[0], to_position: E2E4[1], piece: "P", board_state_after: boards[0], is_check: false, is_checkmate: false, promotion: null, created_at: at(5) },
		{ id: "m3", game_id: GAME_ID, move_number: 3, player: "white", from_position: G1F3[0], to_position: G1F3[1], piece: "N", board_state_after: boards[2], is_check: false, is_checkmate: false, promotion: null, created_at: at(20) },
		{ id: "other", game_id: "another-game", move_number: 1, player: "white", from_position: E2E4[0], to_position: E2E4[1], piece: "P", board_state_after: boards[0], created_at: at(1) },
	];

	const auditLogs = [
		{ id: "a3", game_id: GAME_ID, event_type: "escrow_resolved", event_data: { winner: "white" }, player_address: null, coordinator_tx_hash: "tx-resolve", created_at: at(31) },
		{ id: "a1", game_id: GAME_ID, event_type: "move", event_data: { move_number: 1, client_timestamp: at(4.9), client_ping_ms: 42, ip: "203.0.113.9" }, player_address: "GWHITE", coordinator_tx_hash: null, created_at: at(5) },
		{ id: "a2", game_id: GAME_ID, event_type: "socket_disconnect", event_data: { reason: "transport close", client_ip: "198.51.100.7" }, player_address: "GBLACK", coordinator_tx_hash: null, created_at: at(15) },
		{ id: "a4", game_id: GAME_ID, event_type: "=HYPERLINK(\"http://evil\")", event_data: {}, player_address: "GBLACK", coordinator_tx_hash: null, created_at: at(16) },
		{ id: "x1", game_id: "another-game", event_type: "move", event_data: {}, created_at: at(2) },
	];

	return { game, moves, auditLogs, boards, at, T0 };
}

module.exports = { auditFixture, GAME_ID };
