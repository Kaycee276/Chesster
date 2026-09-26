jest.mock("../config/supabase", () => ({}));

const { ReferralService } = require("../services/referralService");

describe("ReferralService", () => {
	test("calculates an integer 20% commission", () => {
		const service = new ReferralService({ db: {} });
		expect(service.calculateCommission("1000")).toBe(200n);
		expect(service.calculateCommission(99n)).toBe(19n);
	});

	test("accrues the correct commission across multiple matches", async () => {
		let accrued = 0n;
		const creditedGames = new Set();
		const db = {
			rpc: jest.fn(async (_name, params) => {
				if (creditedGames.has(params.p_game_id)) return { data: "0", error: null };
				creditedGames.add(params.p_game_id);
				const commission = (BigInt(params.p_rake_amount) * 20n) / 100n;
				accrued += commission;
				return { data: commission.toString(), error: null };
			}),
		};
		const service = new ReferralService({ db });

		await service.creditReferralCommission("game-a", "1000", "GLOSER");
		await service.creditReferralCommission("game-b", "250", "GLOSER");
		const duplicate = await service.creditReferralCommission("game-a", "1000", "GLOSER");

		expect(accrued).toBe(250n);
		expect(duplicate).toEqual({ credited: false, amount: "0" });
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
