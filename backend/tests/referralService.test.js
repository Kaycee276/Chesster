jest.mock("../config/supabase", () => ({}));

const { ReferralService, getCommissionTier } = require("../services/referralService");

describe("ReferralService", () => {
	test.each([
		[499, "bronze", 1000],
		[500, "silver", 1500],
		[2499, "silver", 1500],
		[2500, "gold", 2000],
	])("selects the correct tier for %i XLM", (volume, tier, commissionBps) => {
		const minimumVolume = tier === "gold" ? 2500 : tier === "silver" ? 500 : 0;
		expect(getCommissionTier(volume)).toEqual({ minimumVolume, tier, commissionBps });
	});

	test("calculates an integer commission at the selected tier", () => {
		const service = new ReferralService({ db: {} });
		expect(service.calculateCommission("1000", 499)).toBe(100n);
		expect(service.calculateCommission("1000", 500)).toBe(150n);
		expect(service.calculateCommission("1000", 2500)).toBe(200n);
	});

	test("returns the database-calculated commission and avoids duplicate games", async () => {
		const creditedGames = new Set();
		const db = {
			rpc: jest.fn(async (_name, params) => {
				if (creditedGames.has(params.p_game_id)) return { data: "0", error: null };
				creditedGames.add(params.p_game_id);
				return { data: "150", error: null };
			}),
		};
		const service = new ReferralService({ db });

		const first = await service.creditReferralCommission("game-a", "1000", "GLOSER");
		const duplicate = await service.creditReferralCommission("game-a", "1000", "GLOSER");

		expect(first).toEqual({ credited: true, amount: "150" });
		expect(duplicate).toEqual({ credited: false, amount: "0" });
		expect(db.rpc).toHaveBeenCalledWith("credit_referral_commission", {
			p_game_id: "game-a",
			p_rake_amount: "1000",
			p_loser_wallet: "GLOSER",
		});
	});

	test("loads a referrer's tier and settled volume from the database", async () => {
		const db = {
			rpc: jest.fn().mockResolvedValue({
				data: [{ tier: "silver", total_referred_volume: "500.0000000", commission_bps: 1500 }],
				error: null,
			}),
		};
		const service = new ReferralService({ db });

		await expect(service.getReferrerTier("GREFERRER")).resolves.toEqual({
			tier: "silver",
			totalReferredVolume: "500.0000000",
			commissionBps: 1500,
		});
		expect(db.rpc).toHaveBeenCalledWith("get_referrer_tier", {
			p_referrer_wallet: "GREFERRER",
		});
	});

	test("completes a claim after the payout provider returns a transaction hash", async () => {
		const db = {
			rpc: jest
				.fn()
				.mockResolvedValueOnce({ data: [{ claim_id: "claim-1", amount: "250" }], error: null })
				.mockResolvedValueOnce({ data: null, error: null }),
		};
		const payoutTransfer = jest.fn().mockResolvedValue({ transactionHash: "tx-1" });
		const service = new ReferralService({ db, payoutTransfer });

		await expect(service.claimCommission("GREFERRER")).resolves.toEqual({
			claimId: "claim-1",
			amount: "250",
			transactionHash: "tx-1",
		});
		expect(db.rpc).toHaveBeenLastCalledWith("complete_referral_commission_claim", {
			p_claim_id: "claim-1",
			p_payout_tx_hash: "tx-1",
		});
	});

	test("restores claimable rewards when payout fails", async () => {
		const db = {
			rpc: jest
				.fn()
				.mockResolvedValueOnce({ data: [{ claim_id: "claim-2", amount: "80" }], error: null })
				.mockResolvedValueOnce({ data: null, error: null }),
		};
		const service = new ReferralService({
			db,
			payoutTransfer: jest.fn().mockRejectedValue(new Error("provider unavailable")),
		});

		await expect(service.claimCommission("GREFERRER")).rejects.toThrow("provider unavailable");
		expect(db.rpc).toHaveBeenLastCalledWith("fail_referral_commission_claim", {
			p_claim_id: "claim-2",
			p_failure_reason: "provider unavailable",
		});
	});
});
