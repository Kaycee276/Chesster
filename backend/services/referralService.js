const axios = require("axios");
const supabase = require("../config/supabase");

const COMMISSION_PERCENT = 20n;

function normalizeAmount(value) {
	if (typeof value === "bigint") return value;
	if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
	if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
	throw new Error("Rake amount must be a non-negative integer");
}

class ReferralService {
	constructor({ db = supabase, payoutTransfer } = {}) {
		this.db = db;
		this.payoutTransfer = payoutTransfer || this.requestPayoutTransfer.bind(this);
	}

	calculateCommission(rakeAmount) {
		return (normalizeAmount(rakeAmount) * COMMISSION_PERCENT) / 100n;
	}

	async creditReferralCommission(gameId, rakeAmount, loserWallet) {
		if (!gameId || !loserWallet) throw new Error("Game ID and loser wallet are required");
		const commission = this.calculateCommission(rakeAmount);
		if (commission === 0n) return { credited: false, amount: "0" };

		const { data, error } = await this.db.rpc("credit_referral_commission", {
			p_game_id: gameId,
			p_rake_amount: normalizeAmount(rakeAmount).toString(),
			p_loser_wallet: loserWallet,
		});
		if (error) throw error;

		const creditedAmount = BigInt(data || 0);
		return { credited: creditedAmount > 0n, amount: creditedAmount.toString() };
	}

	async getStats(walletAddress) {
		const { data: user, error: userError } = await this.db
			.from("users")
			.select("referral_code, claimable_commission")
			.eq("wallet_address", walletAddress)
			.single();
		if (userError) throw userError;

		const { data: rewards, error: rewardsError } = await this.db
			.from("referral_rewards")
			.select("amount, status")
			.eq("referrer_wallet", walletAddress);
		if (rewardsError) throw rewardsError;

		const totals = (rewards || []).reduce(
			(result, reward) => {
				const amount = BigInt(reward.amount);
				result.totalEarned += amount;
				if (reward.status === "claimed") result.totalClaimed += amount;
				return result;
			},
			{ totalEarned: 0n, totalClaimed: 0n },
		);

		return {
			referralCode: user.referral_code,
			claimableCommission: String(user.claimable_commission || "0"),
			totalEarned: totals.totalEarned.toString(),
			totalClaimed: totals.totalClaimed.toString(),
			rewardCount: (rewards || []).length,
		};
	}

	async claimCommission(walletAddress) {
		const { data, error } = await this.db.rpc("begin_referral_commission_claim", {
			p_referrer_wallet: walletAddress,
		});
		if (error) throw error;

		const claim = Array.isArray(data) ? data[0] : data;
		if (!claim) throw new Error("No commission available to claim");

		try {
			const payout = await this.payoutTransfer({
				walletAddress,
				amount: String(claim.amount),
				claimId: claim.claim_id,
			});
			const transactionHash = payout.transactionHash || payout.txHash || payout.id;
			if (!transactionHash) throw new Error("Payout provider did not return a transaction hash");

			const { error: completeError } = await this.db.rpc("complete_referral_commission_claim", {
				p_claim_id: claim.claim_id,
				p_payout_tx_hash: transactionHash,
			});
			if (completeError) throw completeError;

			return { claimId: claim.claim_id, amount: String(claim.amount), transactionHash };
		} catch (claimError) {
			await this.db.rpc("fail_referral_commission_claim", {
				p_claim_id: claim.claim_id,
				p_failure_reason: claimError.message,
			});
			throw claimError;
		}
	}

	async requestPayoutTransfer(payload) {
		if (!process.env.REFERRAL_PAYOUT_URL) {
			throw new Error("Referral payout provider is not configured");
		}
		const response = await axios.post(process.env.REFERRAL_PAYOUT_URL, payload, {
			headers: process.env.REFERRAL_PAYOUT_API_KEY
				? { Authorization: `Bearer ${process.env.REFERRAL_PAYOUT_API_KEY}` }
				: {},
			timeout: Number(process.env.REFERRAL_PAYOUT_TIMEOUT_MS) || 10000,
		});
		return response.data;
	}
}

module.exports = new ReferralService();
module.exports.ReferralService = ReferralService;
module.exports.COMMISSION_PERCENT = COMMISSION_PERCENT;
