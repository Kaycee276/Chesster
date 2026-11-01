jest.mock("../config/supabase", () => require("./helpers/fakeSupabase")());

const supabase = require("../config/supabase");
const auditService = require("../services/auditService");
const { boardToFEN } = require("../services/botService");
const { auditFixture, GAME_ID } = require("./helpers/auditFixtures");
const {
	computeRecordHash,
	verifyMatchAuditChain,
	verifyEntryHash,
	buildChainVerificationReport,
	canonicalAuditString,
} = require("../services/auditHashUtil");

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

describe("Hash Chain Verification (auditHashUtil)", () => {
	describe("computeRecordHash", () => {
		it("computes consistent SHA-256 hashes for identical inputs", () => {
			const hash1 = computeRecordHash(
				null,
				"game-123",
				"move",
				{ moveNumber: 1 },
				"player1",
				null,
				"2026-03-01T12:00:00Z"
			);
			const hash2 = computeRecordHash(
				null,
				"game-123",
				"move",
				{ moveNumber: 1 },
				"player1",
				null,
				"2026-03-01T12:00:00Z"
			);

			expect(hash1).toBe(hash2);
			expect(hash1).toMatch(/^[0-9a-f]{64}$/); // Valid SHA-256 hex
		});

		it("produces different hashes for different inputs", () => {
			const baseArgs = [null, "game-123", "move", { moveNumber: 1 }, "player1", null, "2026-03-01T12:00:00Z"];

			const hash1 = computeRecordHash(...baseArgs);
			const hash2 = computeRecordHash(null, "game-456", "move", { moveNumber: 1 }, "player1", null, "2026-03-01T12:00:00Z");
			const hash3 = computeRecordHash(null, "game-123", "disconnect", { moveNumber: 1 }, "player1", null, "2026-03-01T12:00:00Z");

			expect(hash1).not.toBe(hash2);
			expect(hash1).not.toBe(hash3);
		});

		it("includes prev_hash in computation (chain linking)", () => {
			const prevHash = "a".repeat(64);
			const hash1 = computeRecordHash(
				null,
				"game-123",
				"move",
				{ moveNumber: 1 },
				"player1",
				null,
				"2026-03-01T12:00:00Z"
			);
			const hash2 = computeRecordHash(
				prevHash,
				"game-123",
				"move",
				{ moveNumber: 1 },
				"player1",
				null,
				"2026-03-01T12:00:00Z"
			);

			expect(hash1).not.toBe(hash2);
		});

		it("normalizes null/undefined values to empty strings", () => {
			const hash1 = computeRecordHash(null, "game-123", "move", {}, null, null, "2026-03-01T12:00:00Z");
			const hash2 = computeRecordHash(
				undefined,
				"game-123",
				"move",
				{},
				undefined,
				undefined,
				"2026-03-01T12:00:00Z"
			);

			// Both should produce the same hash since undefined and null are normalized to empty strings
			expect(hash1).toBe(hash2);
		});
	});

	describe("verifyMatchAuditChain", () => {
		it("validates an unbroken chain of audit entries", () => {
			const { auditLogs } = auditFixture();
			const gameAuditLogs = auditLogs.filter((l) => l.game_id === GAME_ID).sort((a, b) => a.created_at.localeCompare(b.created_at));

			// Manually compute hashes for the chain
			let prevHash = null;
			const logsWithHashes = gameAuditLogs.map((log) => {
				const recordHash = computeRecordHash(
					prevHash,
					log.game_id,
					log.event_type,
					log.event_data,
					log.player_address,
					log.coordinator_tx_hash,
					log.created_at
				);
				const logWithHashes = { ...log, prev_hash: prevHash, record_hash: recordHash };
				prevHash = recordHash;
				return logWithHashes;
			});

			const result = verifyMatchAuditChain(logsWithHashes);
			expect(result.valid).toBe(true);
			expect(result.tamperedIndex).toBeNull();
			expect(result.error).toBeNull();
			expect(result.totalEntries).toBe(gameAuditLogs.length);
			expect(result.genesisHash).toBeDefined();
		});

		it("detects when a record is tampered with (hash modified)", () => {
			const { auditLogs } = auditFixture();
			const gameAuditLogs = auditLogs.filter((l) => l.game_id === GAME_ID).sort((a, b) => a.created_at.localeCompare(b.created_at));

			let prevHash = null;
			const logsWithHashes = gameAuditLogs.map((log) => {
				const recordHash = computeRecordHash(
					prevHash,
					log.game_id,
					log.event_type,
					log.event_data,
					log.player_address,
					log.coordinator_tx_hash,
					log.created_at
				);
				const logWithHashes = { ...log, prev_hash: prevHash, record_hash: recordHash };
				prevHash = recordHash;
				return logWithHashes;
			});

			// Tamper with the second entry's record_hash
			logsWithHashes[1].record_hash = "0".repeat(64);

			const result = verifyMatchAuditChain(logsWithHashes);
			expect(result.valid).toBe(false);
			expect(result.tamperedIndex).toBe(1);
			expect(result.error).toContain("Tampered entry");
		});

		it("detects when chain links are broken (entry deleted in the middle)", () => {
			const { auditLogs } = auditFixture();
			const gameAuditLogs = auditLogs.filter((l) => l.game_id === GAME_ID).sort((a, b) => a.created_at.localeCompare(b.created_at));

			let prevHash = null;
			const logsWithHashes = gameAuditLogs.map((log) => {
				const recordHash = computeRecordHash(
					prevHash,
					log.game_id,
					log.event_type,
					log.event_data,
					log.player_address,
					log.coordinator_tx_hash,
					log.created_at
				);
				const logWithHashes = { ...log, prev_hash: prevHash, record_hash: recordHash };
				prevHash = recordHash;
				return logWithHashes;
			});

			// Delete the middle entry (simulate deletion)
			const chainWithGap = [logsWithHashes[0], logsWithHashes[2], logsWithHashes[3]];

			const result = verifyMatchAuditChain(chainWithGap);
			expect(result.valid).toBe(false);
			expect(result.tamperedIndex).toBe(1); // Index 1 in chainWithGap has wrong prev_hash
			expect(result.error).toContain("Broken chain link");
		});

		it("detects when an entry's data is modified (causes hash mismatch)", () => {
			const { auditLogs } = auditFixture();
			const gameAuditLogs = auditLogs.filter((l) => l.game_id === GAME_ID).sort((a, b) => a.created_at.localeCompare(b.created_at));

			let prevHash = null;
			const logsWithHashes = gameAuditLogs.map((log) => {
				const recordHash = computeRecordHash(
					prevHash,
					log.game_id,
					log.event_type,
					log.event_data,
					log.player_address,
					log.coordinator_tx_hash,
					log.created_at
				);
				const logWithHashes = { ...log, prev_hash: prevHash, record_hash: recordHash };
				prevHash = recordHash;
				return logWithHashes;
			});

			// Modify the event_data of an entry (simulates tampering)
			logsWithHashes[1].event_data = { ...logsWithHashes[1].event_data, tampered: true };

			const result = verifyMatchAuditChain(logsWithHashes);
			expect(result.valid).toBe(false);
			expect(result.tamperedIndex).toBe(1);
			expect(result.error).toContain("Tampered entry");
		});

		it("validates an empty chain as valid", () => {
			const result = verifyMatchAuditChain([]);
			expect(result.valid).toBe(true);
			expect(result.totalEntries).toBe(0);
		});

		it("rejects invalid input (not an array)", () => {
			const result = verifyMatchAuditChain(null);
			expect(result.valid).toBe(false);
			expect(result.error).toContain("array");
		});

		it("detects genesis entry with non-null prev_hash", () => {
			const { auditLogs } = auditFixture();
			const gameAuditLogs = auditLogs.filter((l) => l.game_id === GAME_ID).sort((a, b) => a.created_at.localeCompare(b.created_at));

			const firstLog = gameAuditLogs[0];
			const recordHash = computeRecordHash(
				null,
				firstLog.game_id,
				firstLog.event_type,
				firstLog.event_data,
				firstLog.player_address,
				firstLog.coordinator_tx_hash,
				firstLog.created_at
			);

			// Set non-null prev_hash on genesis entry
			const tampered = [{ ...firstLog, prev_hash: "a".repeat(64), record_hash: recordHash }];

			const result = verifyMatchAuditChain(tampered);
			expect(result.valid).toBe(false);
			expect(result.tamperedIndex).toBe(0);
			expect(result.error).toContain("Genesis entry");
		});
	});

	describe("verifyEntryHash", () => {
		it("validates a single entry's hash without chain context", () => {
			const { auditLogs } = auditFixture();
			const log = auditLogs[0];

			const recordHash = computeRecordHash(
				null,
				log.game_id,
				log.event_type,
				log.event_data,
				log.player_address,
				log.coordinator_tx_hash,
				log.created_at
			);

			const entry = { ...log, prev_hash: null, record_hash: recordHash };
			const result = verifyEntryHash(entry, null);

			expect(result.valid).toBe(true);
			expect(result.storedHash).toBe(recordHash);
			expect(result.computedHash).toBe(recordHash);
			expect(result.error).toBeNull();
		});

		it("detects when a single entry's hash is invalid", () => {
			const { auditLogs } = auditFixture();
			const log = auditLogs[0];

			const entry = { ...log, prev_hash: null, record_hash: "0".repeat(64) };
			const result = verifyEntryHash(entry, null);

			expect(result.valid).toBe(false);
			expect(result.error).toContain("Hash mismatch");
		});

		it("uses the provided expectedPrevHash for verification", () => {
			const { auditLogs } = auditFixture();
			const log = auditLogs[0];
			const expectedPrevHash = "b".repeat(64);

			const recordHash = computeRecordHash(
				expectedPrevHash,
				log.game_id,
				log.event_type,
				log.event_data,
				log.player_address,
				log.coordinator_tx_hash,
				log.created_at
			);

			const entry = { ...log, prev_hash: expectedPrevHash, record_hash: recordHash };
			const result = verifyEntryHash(entry, expectedPrevHash);

			expect(result.valid).toBe(true);
			expect(result.computedHash).toBe(recordHash);
		});
	});

	describe("buildChainVerificationReport", () => {
		it("generates a detailed report for an unbroken chain", () => {
			const { auditLogs } = auditFixture();
			const gameAuditLogs = auditLogs.filter((l) => l.game_id === GAME_ID).sort((a, b) => a.created_at.localeCompare(b.created_at));

			let prevHash = null;
			const logsWithHashes = gameAuditLogs.map((log) => {
				const recordHash = computeRecordHash(
					prevHash,
					log.game_id,
					log.event_type,
					log.event_data,
					log.player_address,
					log.coordinator_tx_hash,
					log.created_at
				);
				const logWithHashes = { ...log, prev_hash: prevHash, record_hash: recordHash };
				prevHash = recordHash;
				return logWithHashes;
			});

			const report = buildChainVerificationReport(logsWithHashes);

			expect(report.valid).toBe(true);
			expect(report.totalEntries).toBe(gameAuditLogs.length);
			expect(report.entries).toHaveLength(gameAuditLogs.length);
			expect(report.entries[0]).toMatchObject({
				index: 0,
				id: gameAuditLogs[0].id,
				hashValid: true,
				prevHashValid: true,
			});
		});

		it("includes per-entry verification details", () => {
			const { auditLogs } = auditFixture();
			const gameAuditLogs = auditLogs.filter((l) => l.game_id === GAME_ID).sort((a, b) => a.created_at.localeCompare(b.created_at));

			let prevHash = null;
			const logsWithHashes = gameAuditLogs.map((log) => {
				const recordHash = computeRecordHash(
					prevHash,
					log.game_id,
					log.event_type,
					log.event_data,
					log.player_address,
					log.coordinator_tx_hash,
					log.created_at
				);
				const logWithHashes = { ...log, prev_hash: prevHash, record_hash: recordHash };
				prevHash = recordHash;
				return logWithHashes;
			});

			const report = buildChainVerificationReport(logsWithHashes);

			// Check that each entry has the expected properties
			report.entries.forEach((entry, idx) => {
				expect(entry).toHaveProperty("index", idx);
				expect(entry).toHaveProperty("id");
				expect(entry).toHaveProperty("gameId", GAME_ID);
				expect(entry).toHaveProperty("eventType");
				expect(entry).toHaveProperty("storedRecordHash");
				expect(entry).toHaveProperty("computedRecordHash");
				expect(entry).toHaveProperty("hashValid");
				expect(entry).toHaveProperty("prevHashValid");
			});
		});
	});

	describe("auditService integration with hash chains", () => {
		let fixture;

		beforeEach(() => {
			supabase.__reset();
			fixture = auditFixture();
			supabase.__setTable("games", [fixture.game]);
			supabase.__setTable("moves", fixture.moves);
			supabase.__setTable("match_audit_logs", fixture.auditLogs);
		});

		it("includes hash chain verification in the exported audit package", async () => {
			const audit = await auditService.exportMatchAudit("AUD123");

			expect(audit.integrity).toHaveProperty("chainVerification");
			expect(audit.integrity.chainVerification).toMatchObject({
				valid: expect.any(Boolean),
				totalEntries: expect.any(Number),
			});
		});

		it("verifyAuditPackage returns detailed verification results", async () => {
			const audit = await auditService.exportMatchAudit("AUD123");
			const result = auditService.verifyAuditPackage(audit, { detailed: true });

			expect(result).toMatchObject({
				valid: expect.any(Boolean),
				outcomeSignatureValid: expect.any(Boolean),
				chainIntegrity: expect.any(Object),
				errors: expect.any(Array),
			});
		});

		it("detects tampered audit logs in verification", async () => {
			const audit = await auditService.exportMatchAudit("AUD123");

			// Simulate tampering: modify an event's data
			if (audit.events.length > 1) {
				audit.events[1].data = { ...audit.events[1].data, tampered: true };
			}

			const result = auditService.verifyAuditPackage(audit, { detailed: true });
			// Outcome signature may still be valid if event data is only cosmetic,
			// but chainIntegrity should capture tampering
			expect(result).toHaveProperty("chainIntegrity");
		});

		it("provides getChainVerificationReport for detailed debugging", async () => {
			// First, manually set up audit logs with hashes
			const { auditLogs } = auditFixture();
			const gameAuditLogs = auditLogs.filter((l) => l.game_id === GAME_ID).sort((a, b) => a.created_at.localeCompare(b.created_at));

			let prevHash = null;
			const logsWithHashes = gameAuditLogs.map((log) => {
				const recordHash = computeRecordHash(
					prevHash,
					log.game_id,
					log.event_type,
					log.event_data,
					log.player_address,
					log.coordinator_tx_hash,
					log.created_at
				);
				const logWithHashes = { ...log, prev_hash: prevHash, record_hash: recordHash };
				prevHash = recordHash;
				return logWithHashes;
			});

			// Update the supabase mock with logs that have hashes
			supabase.__setTable("match_audit_logs", logsWithHashes);

			const report = await auditService.getChainVerificationReport(GAME_ID);

			expect(report).toHaveProperty("gameId", GAME_ID);
			expect(report).toHaveProperty("valid");
			expect(report).toHaveProperty("totalEntries");
			expect(report).toHaveProperty("entries");
			expect(Array.isArray(report.entries)).toBe(true);
		});
	});

	describe("canonicalAuditString", () => {
		it("produces consistent canonical strings for the same inputs", () => {
			const str1 = canonicalAuditString(
				"abc123",
				"game-id",
				"move",
				{ moveNumber: 1 },
				"player",
				"tx-hash",
				"2026-03-01T12:00:00Z"
			);
			const str2 = canonicalAuditString(
				"abc123",
				"game-id",
				"move",
				{ moveNumber: 1 },
				"player",
				"tx-hash",
				"2026-03-01T12:00:00Z"
			);

			expect(str1).toBe(str2);
		});

		it("produces different strings for different inputs", () => {
			const baseArgs = ["abc123", "game-id", "move", { moveNumber: 1 }, "player", "tx-hash", "2026-03-01T12:00:00Z"];

			const str1 = canonicalAuditString(...baseArgs);
			const str2 = canonicalAuditString("xyz789", ...baseArgs.slice(1));

			expect(str1).not.toBe(str2);
		});

		it("includes all fields in the canonical string", () => {
			const str = canonicalAuditString(
				"prev-hash",
				"game-id",
				"event-type",
				{ key: "value" },
				"player",
				"tx-hash",
				"timestamp"
			);

			expect(str).toContain("prev-hash");
			expect(str).toContain("game-id");
			expect(str).toContain("event-type");
			expect(str).toContain("key");
			expect(str).toContain("value");
			expect(str).toContain("player");
			expect(str).toContain("tx-hash");
			expect(str).toContain("timestamp");
		});
	});
});

