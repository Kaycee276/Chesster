/**
 * Tests for CronService.cleanupAbandonedLobbies
 *
 * Covers:
 *   1. Unwagered lobby — expires cleanly, no escrow calls.
 *   2. Wagered lobby — full success path with refund and tx hash.
 *   3. Transient chain error — escrow_refund_status marked 'failed'; retry succeeds next run.
 *   4. Concurrent cleanup — second run does NOT re-issue a refund that already succeeded.
 *   5. Lobby becomes active during processing — status='active' row is never expired.
 *   6. Empty batch — returns { success: true, cleaned: 0 } immediately.
 *   7. Mixed batch — unwagered + wagered processed together, counts are accurate.
 *   8. getPendingLobbyRefunds failure — non-fatal; fresh-batch refunds still proceed.
 *   9. claimExpiredWaitingLobbies failure — propagates as { success: false, error }.
 *  10. Batch size is bounded by cleanupBatchSize.
 */

jest.mock("../config/supabase", () => ({}));

const { CronService } = require("../services/cronService");

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeGame(overrides = {}) {
	return {
		id: overrides.id ?? "game-uuid-1",
		game_code: overrides.game_code ?? "ABC123",
		wager_amount: overrides.wager_amount ?? null,
		escrow_status: overrides.escrow_status ?? null,
		escrow_refund_status: overrides.escrow_refund_status ?? null,
		...overrides,
	};
}

function makeGameModel(overrides = {}) {
	return {
		claimExpiredWaitingLobbies: jest.fn().mockResolvedValue([]),
		getPendingLobbyRefunds: jest.fn().mockResolvedValue([]),
		updateLobbyRefundStatus: jest.fn().mockResolvedValue(undefined),
		...overrides,
	};
}

function makeEscrow(overrides = {}) {
	return {
		refundUnresolvedMatch: jest.fn().mockResolvedValue({ hash: "tx-hash-abc" }),
		...overrides,
	};
}

function makeCron(gameOverrides = {}, escrowOverrides = {}) {
	const game = makeGameModel(gameOverrides);
	const escrow = makeEscrow(escrowOverrides);
	const service = new CronService({ game, escrow });
	return { service, game, escrow };
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe("CronService.cleanupAbandonedLobbies", () => {

	// ── 1. Empty batch ─────────────────────────────────────────────────────────
	describe("when there are no expired lobbies", () => {
		it("returns success with cleaned=0 and makes no escrow calls", async () => {
			const { service, escrow } = makeCron();

			const result = await service.cleanupAbandonedLobbies();

			expect(result).toEqual({ success: true, cleaned: 0, refundSucceeded: 0, refundFailed: 0 });
			expect(escrow.refundUnresolvedMatch).not.toHaveBeenCalled();
		});
	});

	// ── 2. Unwagered lobby ─────────────────────────────────────────────────────
	describe("unwagered lobby", () => {
		it("expires the lobby and makes no escrow call", async () => {
			const lobby = makeGame({ id: "u1", game_code: "NOWAG", wager_amount: null });
			const { service, game, escrow } = makeCron({
				claimExpiredWaitingLobbies: jest.fn().mockResolvedValue([lobby]),
			});

			const result = await service.cleanupAbandonedLobbies();

			expect(result.success).toBe(true);
			expect(result.cleaned).toBe(1);
			expect(result.refundSucceeded).toBe(0);
			expect(result.refundFailed).toBe(0);
			expect(escrow.refundUnresolvedMatch).not.toHaveBeenCalled();
			// updateLobbyRefundStatus should not be called for an unwagered lobby
			expect(game.updateLobbyRefundStatus).not.toHaveBeenCalled();
		});
	});

	// ── 3. Wagered lobby — successful refund ───────────────────────────────────
	describe("wagered abandoned lobby — refund succeeds", () => {
		it("issues a refund, persists the tx hash, and returns succeeded=1", async () => {
			const lobby = makeGame({
				id: "w1",
				game_code: "WAGER1",
				wager_amount: "10",
				escrow_status: "pending",
				escrow_refund_status: "none",
			});
			const { service, game, escrow } = makeCron({
				claimExpiredWaitingLobbies: jest.fn().mockResolvedValue([lobby]),
			});

			const result = await service.cleanupAbandonedLobbies();

			expect(result.success).toBe(true);
			expect(result.cleaned).toBe(1);
			expect(result.refundSucceeded).toBe(1);
			expect(result.refundFailed).toBe(0);

			// escrow call
			expect(escrow.refundUnresolvedMatch).toHaveBeenCalledWith("WAGER1");

			// status updates: 'pending' before the call, then 'succeeded' with tx hash
			expect(game.updateLobbyRefundStatus).toHaveBeenNthCalledWith(1, "w1", "pending");
			expect(game.updateLobbyRefundStatus).toHaveBeenNthCalledWith(2, "w1", "succeeded", "tx-hash-abc");
		});
	});

	// ── 4. Transient chain error — marks failed, retried on next run ───────────
	describe("wagered lobby — transient chain error", () => {
		it("marks the lobby as 'failed' and reports it in the failures list", async () => {
			const lobby = makeGame({
				id: "w2",
				game_code: "WAGER2",
				wager_amount: "10",
				escrow_status: "pending",
				escrow_refund_status: "none",
			});
			const { service, game, escrow } = makeCron(
				{ claimExpiredWaitingLobbies: jest.fn().mockResolvedValue([lobby]) },
				{ refundUnresolvedMatch: jest.fn().mockRejectedValue(new Error("ECONNRESET")) },
			);

			const result = await service.cleanupAbandonedLobbies();

			expect(result.success).toBe(true);
			expect(result.refundFailed).toBe(1);
			expect(result.refundSucceeded).toBe(0);
			expect(result.failures).toHaveLength(1);
			expect(result.failures[0].game_code).toBe("WAGER2");
			expect(result.failures[0].error).toMatch(/ECONNRESET/);

			// Status should have been set to 'pending' then 'failed'
			expect(game.updateLobbyRefundStatus).toHaveBeenCalledWith("w2", "pending");
			expect(game.updateLobbyRefundStatus).toHaveBeenCalledWith("w2", "failed");
		});

		it("retries a 'failed' lobby on the next cleanup run and succeeds", async () => {
			const failedLobby = makeGame({
				id: "w3",
				game_code: "WAGER3",
				wager_amount: "10",
				escrow_status: "pending",
				escrow_refund_status: "failed", // previous run failed
			});
			const { service, game, escrow } = makeCron({
				claimExpiredWaitingLobbies: jest.fn().mockResolvedValue([]), // nothing new
				getPendingLobbyRefunds: jest.fn().mockResolvedValue([failedLobby]),
			});

			const result = await service.cleanupAbandonedLobbies();

			expect(result.success).toBe(true);
			expect(result.cleaned).toBe(0); // no new lobbies expired
			expect(result.refundSucceeded).toBe(1);
			expect(escrow.refundUnresolvedMatch).toHaveBeenCalledWith("WAGER3");
			expect(game.updateLobbyRefundStatus).toHaveBeenCalledWith("w3", "succeeded", "tx-hash-abc");
		});
	});

	// ── 5. Concurrent cleanup — already succeeded lobby not refunded again ──────
	describe("idempotency — concurrent or repeated runs", () => {
		it("does not call refundUnresolvedMatch when escrow_refund_status is already 'succeeded'", async () => {
			const alreadyRefunded = makeGame({
				id: "w4",
				game_code: "WAGER4",
				wager_amount: "10",
				escrow_status: "pending",
				escrow_refund_status: "succeeded",
			});
			const { service, escrow } = makeCron({
				claimExpiredWaitingLobbies: jest.fn().mockResolvedValue([alreadyRefunded]),
			});

			const result = await service.cleanupAbandonedLobbies();

			expect(result.refundSucceeded).toBe(0);
			expect(escrow.refundUnresolvedMatch).not.toHaveBeenCalled();
		});

		it("deduplicates a lobby that appears in both fresh and retry batches", async () => {
			const lobby = makeGame({
				id: "w5",
				game_code: "WAGER5",
				wager_amount: "10",
				escrow_status: "pending",
				escrow_refund_status: "none",
			});
			const { service, escrow } = makeCron({
				claimExpiredWaitingLobbies: jest.fn().mockResolvedValue([lobby]),
				getPendingLobbyRefunds: jest.fn().mockResolvedValue([lobby]), // same row
			});

			const result = await service.cleanupAbandonedLobbies();

			// Even though the lobby appeared twice, refund is called exactly once
			expect(escrow.refundUnresolvedMatch).toHaveBeenCalledTimes(1);
			expect(result.refundSucceeded).toBe(1);
		});
	});

	// ── 6. Lobby becomes active during processing ──────────────────────────────
	describe("lobby becomes active during processing", () => {
		it("does not expire a lobby that became 'active' before the atomic update", async () => {
			// claimExpiredWaitingLobbies returns empty because the DB UPDATE's
			// re-asserted status='waiting' WHERE clause excluded the newly active row.
			const { service, escrow } = makeCron({
				claimExpiredWaitingLobbies: jest.fn().mockResolvedValue([]),
			});

			const result = await service.cleanupAbandonedLobbies();

			expect(result.cleaned).toBe(0);
			expect(escrow.refundUnresolvedMatch).not.toHaveBeenCalled();
		});

		it("does not attempt a refund when escrow_status is 'active' (join in progress)", async () => {
			// A lobby whose escrow flipped to 'active' (join confirmed on-chain)
			// before cleanup got to process it should be skipped.
			const activeLobby = makeGame({
				id: "w6",
				game_code: "WAGER6",
				wager_amount: "10",
				escrow_status: "active", // already joined on-chain
				escrow_refund_status: "none",
			});
			const { service, escrow } = makeCron({
				claimExpiredWaitingLobbies: jest.fn().mockResolvedValue([activeLobby]),
			});

			const result = await service.cleanupAbandonedLobbies();

			expect(escrow.refundUnresolvedMatch).not.toHaveBeenCalled();
			expect(result.refundSucceeded).toBe(0);
		});
	});

	// ── 7. Mixed batch ─────────────────────────────────────────────────────────
	describe("mixed batch of unwagered and wagered lobbies", () => {
		it("expires all, refunds only wagered ones, and counts accurately", async () => {
			const unwagered = makeGame({ id: "u1", game_code: "NOWAG", wager_amount: null });
			const wagered1 = makeGame({ id: "w7", game_code: "WAG001", wager_amount: "5", escrow_status: "pending", escrow_refund_status: "none" });
			const wagered2 = makeGame({ id: "w8", game_code: "WAG002", wager_amount: "5", escrow_status: "pending", escrow_refund_status: "none" });

			const { service, escrow } = makeCron({
				claimExpiredWaitingLobbies: jest.fn().mockResolvedValue([unwagered, wagered1, wagered2]),
			});

			const result = await service.cleanupAbandonedLobbies();

			expect(result.cleaned).toBe(3);
			expect(result.refundSucceeded).toBe(2);
			expect(result.refundFailed).toBe(0);
			expect(escrow.refundUnresolvedMatch).toHaveBeenCalledTimes(2);
			expect(escrow.refundUnresolvedMatch).toHaveBeenCalledWith("WAG001");
			expect(escrow.refundUnresolvedMatch).toHaveBeenCalledWith("WAG002");
		});
	});

	// ── 8. getPendingLobbyRefunds failure — non-fatal ──────────────────────────
	describe("getPendingLobbyRefunds failure", () => {
		it("continues with fresh-batch refunds when retry fetch throws", async () => {
			const freshLobby = makeGame({
				id: "w9",
				game_code: "FRESHW",
				wager_amount: "5",
				escrow_status: "pending",
				escrow_refund_status: "none",
			});
			const { service, escrow } = makeCron({
				claimExpiredWaitingLobbies: jest.fn().mockResolvedValue([freshLobby]),
				getPendingLobbyRefunds: jest.fn().mockRejectedValue(new Error("DB hiccup")),
			});

			const result = await service.cleanupAbandonedLobbies();

			expect(result.success).toBe(true);
			// Fresh batch still processed
			expect(result.refundSucceeded).toBe(1);
			expect(escrow.refundUnresolvedMatch).toHaveBeenCalledWith("FRESHW");
		});
	});

	// ── 9. claimExpiredWaitingLobbies failure — propagates ────────────────────
	describe("claimExpiredWaitingLobbies failure", () => {
		it("returns { success: false, error } when the claim step throws", async () => {
			const { service } = makeCron({
				claimExpiredWaitingLobbies: jest.fn().mockRejectedValue(new Error("Connection refused")),
			});

			const result = await service.cleanupAbandonedLobbies();

			expect(result.success).toBe(false);
			expect(result.error).toMatch(/Connection refused/);
		});
	});

	// ── 10. Batch size is bounded ─────────────────────────────────────────────
	describe("batch size", () => {
		it("passes cleanupBatchSize to claimExpiredWaitingLobbies", async () => {
			const { service, game } = makeCron();
			service.cleanupBatchSize = 50;

			await service.cleanupAbandonedLobbies();

			expect(game.claimExpiredWaitingLobbies).toHaveBeenCalledWith(
				expect.any(String), // ISO threshold
				50,
			);
		});
	});

	// ── 11. No failures key when all succeed ──────────────────────────────────
	describe("result shape", () => {
		it("omits the failures key when there are no failures", async () => {
			const { service } = makeCron();

			const result = await service.cleanupAbandonedLobbies();

			expect(Object.prototype.hasOwnProperty.call(result, "failures")).toBe(false);
		});

		it("includes failures key only when at least one refund fails", async () => {
			const lobby = makeGame({
				id: "wF",
				game_code: "FAIL01",
				wager_amount: "5",
				escrow_status: "pending",
				escrow_refund_status: "none",
			});
			const { service } = makeCron(
				{ claimExpiredWaitingLobbies: jest.fn().mockResolvedValue([lobby]) },
				{ refundUnresolvedMatch: jest.fn().mockRejectedValue(new Error("timeout")) },
			);

			const result = await service.cleanupAbandonedLobbies();

			expect(result.failures).toBeDefined();
			expect(result.failures).toHaveLength(1);
		});
	});

	// ── 12. Marking pending fails — lobby skipped gracefully ──────────────────
	describe("updateLobbyRefundStatus (mark pending) failure", () => {
		it("skips the refund call and continues with remaining lobbies", async () => {
			const badLobby = makeGame({
				id: "wBAD",
				game_code: "BADPEND",
				wager_amount: "5",
				escrow_status: "pending",
				escrow_refund_status: "none",
			});
			const goodLobby = makeGame({
				id: "wGOOD",
				game_code: "GOODONE",
				wager_amount: "5",
				escrow_status: "pending",
				escrow_refund_status: "none",
			});

			let callCount = 0;
			const game = makeGameModel({
				claimExpiredWaitingLobbies: jest.fn().mockResolvedValue([badLobby, goodLobby]),
				updateLobbyRefundStatus: jest.fn().mockImplementation(() => {
					callCount++;
					// First call (mark badLobby pending) throws; all subsequent succeed
					if (callCount === 1) return Promise.reject(new Error("write fail"));
					return Promise.resolve();
				}),
			});
			const escrow = makeEscrow();
			const service = new CronService({ game, escrow });

			const result = await service.cleanupAbandonedLobbies();

			// badLobby was skipped (no escrow call for it); goodLobby was refunded
			expect(escrow.refundUnresolvedMatch).toHaveBeenCalledTimes(1);
			expect(escrow.refundUnresolvedMatch).toHaveBeenCalledWith("GOODONE");
			expect(result.refundSucceeded).toBe(1);
		});
	});
});
