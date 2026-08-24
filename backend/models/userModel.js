const supabase = require("../config/supabase");

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
	async findOrCreateByAddress(address) {
		const { data: existing, error: fetchError } = await supabase
			.from("users")
			.select("*")
			.eq("wallet_address", address)
			.maybeSingle();

		if (fetchError) throw fetchError;
		if (existing) return existing;

		const { data, error } = await supabase
			.from("users")
			.insert({
				wallet_address: address,
				username: address.slice(0, 8),
			})
			.select()
			.single();

		if (error) throw error;
		return data;
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
