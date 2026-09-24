const crypto = require("crypto");
const supabase = require("../config/supabase");
const eventBus = require("../services/eventBus");

const REFERRAL_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateReferralCode() {
	const bytes = crypto.randomBytes(8);
	return Array.from(bytes, (byte) => REFERRAL_ALPHABET[byte % REFERRAL_ALPHABET.length]).join("");
}

/**
 * UserModel — Supabase-backed storage for player profiles.
 * A "user" is identified by their Stellar wallet address (same address used
 * for game participation / escrow), so no separate signup/password flow is
 * required — see authService.js for the challenge/signature login flow that
 * proves ownership of the address before a profile can be read or edited.
 */
class UserModel {
	/**
	 * Fetch a user profile by wallet address, creating a default row the
	 * first time that address is seen (e.g. right after a successful login).
	 */
	async findOrCreateByAddress(address, referralCode = null) {
		const { data: existing, error: fetchError } = await supabase
			.from("users")
			.select("*")
			.eq("wallet_address", address)
			.maybeSingle();

		if (fetchError) throw fetchError;
		if (existing) {
			if (referralCode && !existing.referred_by_wallet) {
				return this.linkReferrer(address, referralCode);
			}
			return existing;
		}

		let referredByWallet = null;
		if (referralCode) {
			const referrer = await this.getByReferralCode(referralCode);
			if (referrer.wallet_address === address) throw new Error("A wallet cannot refer itself");
			referredByWallet = referrer.wallet_address;
		}

		for (let attempt = 0; attempt < 5; attempt += 1) {
			const { data, error } = await supabase
				.from("users")
				.insert({
					wallet_address: address,
					username: address.slice(0, 8),
					referral_code: generateReferralCode(),
					referred_by_wallet: referredByWallet,
				})
				.select()
				.single();

			if (!error) {
				eventBus.publish("player.registered", {
					userId: data.id,
					walletAddress: data.wallet_address,
				}).catch(() => {});
				return data;
			}
			if (error.code !== "23505" || !String(error.message).includes("referral_code")) throw error;
		}

		throw new Error("Unable to allocate a unique referral code");
	}

	async getByReferralCode(referralCode) {
		const normalizedCode = String(referralCode).trim().toUpperCase();
		const { data, error } = await supabase
			.from("users")
			.select("wallet_address")
			.eq("referral_code", normalizedCode)
			.maybeSingle();
		if (error) throw error;
		if (!data) throw new Error("Referral code not found");
		return data;
	}

	async linkReferrer(address, referralCode) {
		const referrer = await this.getByReferralCode(referralCode);
		if (referrer.wallet_address === address) throw new Error("A wallet cannot refer itself");

		const { data, error } = await supabase
			.from("users")
			.update({ referred_by_wallet: referrer.wallet_address })
			.eq("wallet_address", address)
			.is("referred_by_wallet", null)
			.select()
			.maybeSingle();
		if (error) throw error;
		return data || this.getByAddress(address);
	}

	async getByAddress(address) {
		const { data, error } = await supabase
			.from("users")
			.select("*")
			.eq("wallet_address", address)
			.maybeSingle();

		if (error) throw error;
		if (!data) throw new Error("Profile not found");
		return data;
	}

	/**
	 * Update customizable profile fields. Only a known allow-list of columns
	 * may be changed here so authenticated users can't overwrite internal
	 * bookkeeping columns (wallet_address, created_at, ...).
	 */
	async updateProfile(address, updates = {}) {
		const ALLOWED_FIELDS = ["username", "avatar_url", "bio", "country"];
		const sanitized = {};

		for (const field of ALLOWED_FIELDS) {
			if (updates[field] !== undefined) {
				sanitized[field] = String(updates[field]).slice(0, 280);
			}
		}

		if (Object.keys(sanitized).length === 0) {
			throw new Error("No valid profile fields to update");
		}

		if (sanitized.username !== undefined && sanitized.username.trim().length === 0) {
			throw new Error("Username cannot be empty");
		}

		const { data, error } = await supabase
			.from("users")
			.update(sanitized)
			.eq("wallet_address", address)
			.select()
			.single();

		if (error) throw error;
		if (!data) throw new Error("Profile not found");
		return data;
	}
}

module.exports = new UserModel();
module.exports.generateReferralCode = generateReferralCode;
