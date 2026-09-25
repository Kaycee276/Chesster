const BACKEND_URL =
	import.meta.env.VITE_BACKEND_URL || "http://localhost:3000/";
const API_URL = `${BACKEND_URL}api`;

export interface ReferralStats {
	referral_code: string;
	total_invited: number;
	total_wager_volume: number;
	total_commission_earned: number;
	claimable_xlm: number;
	claimable_usdc: number;
	referred_users: ReferredUser[];
}

export interface ReferredUser {
	address: string;
	signup_date: string;
	matches_played: number;
}

export interface ClaimReferralEarningsRequest {
	signed_payload: string;
	wallet_address: string;
}

export interface ClaimReferralEarningsResponse {
	success: boolean;
	transaction_id?: string;
	amount_xlm?: number;
	amount_usdc?: number;
	error?: string;
}

export const referralApi = {
	getReferralStats: async (
		playerAddress: string,
	): Promise<{ success: boolean; data?: ReferralStats; error?: string }> => {
		const res = await fetch(`${API_URL}/referrals/stats?address=${playerAddress}`);
		return res.json();
	},

	claimReferralEarnings: async (
		request: ClaimReferralEarningsRequest,
	): Promise<ClaimReferralEarningsResponse> => {
		const res = await fetch(`${API_URL}/referrals/claim`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(request),
		});
		return res.json();
	},
};
