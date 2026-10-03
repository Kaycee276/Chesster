jest.mock("../config/supabase", () => require("./helpers/fakeSupabase")());

const supabase = require("../config/supabase");
const auditService = require("../services/auditService");
const { boardToFEN } = require("../services/botService");
const { auditFixture, GAME_ID } = require("./helpers/auditFixtures");

describe("auditService", () => {
	let fixture;

	beforeEach(() => {
		supabase.__reset();
		fixture = auditFixture();
		supabase.__setTable("games", [fixture.game]);
		supabase.__setTable("moves", fixture.moves);
		supabase.__setTable("match_audit_logs", fixture.auditLogs);
		delete process.env.ADMIN_ADDRESSES;
	});

	describe("getGame", () => {
		it("looks games up by UUID", async () => {
			const game = await auditService.getGame(GAME_ID);
			expect(game.game_code).toBe("AUD123");
			expect(supabase.__queries.at(-1).filters).toEqual([["id", GAME_ID]]);
		});

		it("looks games up by game code", async () => {
			const game = await auditService.getGame("AUD123");
			expect(game.id).toBe(GAME_ID);
			expect(supabase.__queries.at(-1).filters).toEqual([["game_code", "AUD123"]]);
		});

		it("returns null for unknown games", async () => {
			expect(await auditService.getGame("NOPE00")).toBeNull();
			expect(await auditService.exportMatchAudit("NOPE00")).toBeNull();
		});
	});

	describe("exportMatchAudit", () => {
		it("exports every move of the game, in move order, matching the database records", async () => {
			const audit = await auditService.exportMatchAudit("AUD123");
			const dbMoves = fixture.moves.filter((m) => m.game_id === GAME_ID).sort((a, b) => a.move_number - b.move_number);

			expect(audit.moves).toHaveLength(dbMoves.length);
			audit.moves.forEach((move, i) => {
				const row = dbMoves[i];
				expect(move).toMatchObject({
					sequence: i + 1,
					moveNumber: row.move_number,
					player: row.player,
					from: row.from_position,
					to: row.to_position,
					piece: row.piece,
					serverReceivedAt: row.created_at,
					fenAfter: boardToFEN(row.board_state_after, row.player === "white" ? "black" : "white", row.move_number),
				});
			});
			expect(audit.moves.map((m) => m.uci)).toEqual(["e2e4", "e7e5", "g1f3"]);
			expect(audit.moves[0].fenAfter).toBe("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b - - 0 1");
		});

		it("derives client timestamps, latency, ping and think time from move telemetry", async () => {
			const { moves } = await auditService.exportMatchAudit("AUD123");

			expect(moves[0]).toMatchObject({
				clientTimestamp: fixture.at(4.9),
				moveLatencyMs: 100,
				clientPingMs: 42,
				thinkTimeMs: 5000, // since game start
			});
			expect(moves[1]).toMatchObject({ clientTimestamp: null, moveLatencyMs: null, clientPingMs: null, thinkTimeMs: 7000 });
			expect(moves[2].thinkTimeMs).toBe(8000);
		});

		it("exports all audit events for the game in chronological order", async () => {
			const { events, summary } = await auditService.exportMatchAudit("AUD123");
			const dbLogs = fixture.auditLogs.filter((l) => l.game_id === GAME_ID).sort((a, b) => a.created_at.localeCompare(b.created_at));

			expect(events.map((e) => e.id)).toEqual(dbLogs.map((l) => l.id));
			events.forEach((event, i) => {
				expect(event.sequence).toBe(i + 1);
				expect(event.eventType).toBe(dbLogs[i].event_type);
				expect(event.serverReceivedAt).toBe(dbLogs[i].created_at);
				expect(event.playerAddress).toBe(dbLogs[i].player_address);
				expect(event.coordinatorTxHash).toBe(dbLogs[i].coordinator_tx_hash);
			});
			expect(summary).toEqual({ totalMoves: 3, totalEvents: 4, disconnectEvents: 1, coordinatorTransactions: 1 });
		});

		it("hashes client IPs and never exports them raw", async () => {
			const audit = await auditService.exportMatchAudit("AUD123");
			const serialized = JSON.stringify(audit);

			expect(serialized).not.toContain("203.0.113.9");
			expect(serialized).not.toContain("198.51.100.7");
			const [moveEvent, disconnect] = audit.events;
			expect(moveEvent.clientIpHash).toBe(auditService.hashIp("203.0.113.9"));
			expect(disconnect.clientIpHash).toBe(auditService.hashIp("198.51.100.7"));
			expect(disconnect.data).toEqual({ reason: "transport close" });
		});

		it("includes the match outcome and escrow transactions", async () => {
			const { match, escrow } = await auditService.exportMatchAudit(GAME_ID);

			expect(match).toMatchObject({
				gameId: GAME_ID,
				gameCode: "AUD123",
				status: "finished",
				winner: "white",
				endReason: "resignation",
				players: { white: "GWHITE", black: "GBLACK" },
				resolvedAt: fixture.game.updated_at,
				startedAt: fixture.game.game_started_at,
				finalFen: boardToFEN(fixture.game.board_state, "black", 3),
			});
			expect(escrow).toEqual({ status: "settled", createTxHash: "tx-create", joinTxHash: "tx-join", resolveTxHash: "tx-resolve" });
		});

		it("leaves resolvedAt empty for matches that have not finished", async () => {
			supabase.__setTable("games", [{ ...fixture.game, status: "active", winner: null }]);
			const { match } = await auditService.exportMatchAudit("AUD123");
			expect(match.resolvedAt).toBeNull();
		});
	});

	describe("outcome signature", () => {
		it("signs the outcome so the package verifies", async () => {
			const audit = await auditService.exportMatchAudit("AUD123");

			expect(audit.integrity.algorithm).toBe("HMAC-SHA256");
			expect(audit.integrity.signature).toMatch(/^[0-9a-f]{64}$/);
			expect(audit.integrity.outcome).toMatchObject({ winner: "white", moveCount: 3, escrowResolveTxHash: "tx-resolve" });
			expect(auditService.verifyAuditPackage(audit)).toBe(true);
		});

		it("detects a tampered move, event or outcome", async () => {
			const audit = await auditService.exportMatchAudit("AUD123");
			const clone = () => JSON.parse(JSON.stringify(audit));

			const movedMove = clone();
			movedMove.moves[1].uci = "d7d5";
			expect(auditService.verifyAuditPackage(movedMove)).toBe(false);

			const droppedEvent = clone();
			droppedEvent.events.splice(1, 1);
			expect(auditService.verifyAuditPackage(droppedEvent)).toBe(false);

			const flippedWinner = clone();
			flippedWinner.integrity.outcome.winner = "black";
			expect(auditService.verifyAuditPackage(flippedWinner)).toBe(false);

			const forged = clone();
			forged.integrity.signature = "0".repeat(64);
			expect(auditService.verifyAuditPackage(forged)).toBe(false);
		});

		it("produces a stable signature for the same records", async () => {
			const first = await auditService.exportMatchAudit("AUD123");
			const second = await auditService.exportMatchAudit(GAME_ID);
			expect(second.integrity.signature).toBe(first.integrity.signature);
		});
	});

	describe("canAccessAudit", () => {
		const { game } = auditFixture();

		it("allows the two match players", () => {
			expect(auditService.canAccessAudit({ address: "GWHITE" }, game)).toBe(true);
			expect(auditService.canAccessAudit({ address: "GBLACK" }, game)).toBe(true);
		});

		it("denies anyone else, including anonymous callers", () => {
			expect(auditService.canAccessAudit({ address: "GSTRANGER" }, game)).toBe(false);
			expect(auditService.canAccessAudit(null, game)).toBe(false);
			expect(auditService.canAccessAudit({}, game)).toBe(false);
		});

		it("allows configured admin addresses and admin-role tokens", () => {
			process.env.ADMIN_ADDRESSES = "GADMIN1, GADMIN2";
			expect(auditService.canAccessAudit({ address: "GADMIN2" }, game)).toBe(true);
			expect(auditService.canAccessAudit({ address: "GSTRANGER", role: "admin" }, game)).toBe(true);
		});
	});

	describe("toCsv", () => {
		it("renders a chronological timeline of moves and events", async () => {
			const audit = await auditService.exportMatchAudit("AUD123");
			const lines = auditService.toCsv(audit).trim().split("\r\n");

			expect(lines[0]).toBe(
				"sequence,kind,timestamp,player,event_type,move_number,uci,piece,client_timestamp,move_latency_ms,client_ping_ms,think_time_ms,client_ip_hash,coordinator_tx_hash,fen_after",
			);
			const rows = lines.slice(1).map((line) => line.split(","));
			expect(rows).toHaveLength(audit.moves.length + audit.events.length);

			const timestamps = rows.map((r) => r[2]);
			expect(timestamps).toEqual([...timestamps].sort());
			expect(rows.map((r) => r[0])).toEqual(rows.map((_, i) => String(i + 1)));
			// Move 1 and its telemetry event share a timestamp; the move comes first.
			expect(rows[0].slice(1, 7)).toEqual(["move", fixture.at(5), "white", "move", "1", "e2e4"]);
			expect(rows[1][1]).toBe("event");
		});

		it("neutralises spreadsheet formula injection and quotes special characters", async () => {
			const csv = auditService.toCsv(await auditService.exportMatchAudit("AUD123"));
			expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
			expect(csv).not.toMatch(/,=HYPERLINK/);
		});
	});
});
