const authService = require("../services/authService");
const sessionService = require("../services/sessionService");
const userModel = require("../models/userModel");

class AuthController {
	/**
	 * POST /api/auth/challenge { address }
	 * Returns a one-time message the wallet must sign to prove ownership.
	 */
	async createChallenge(req, res) {
		try {
			const { address, purpose = "login" } = req.body;
			const message = authService.createChallenge(address, purpose);
			res.json({ success: true, data: { message } });
		} catch (error) {
			res.status(400).json({ success: false, error: error.message });
		}
	}

	/**
	 * POST /api/auth/login { address, signature }
	 * Verifies the signed challenge and issues a JWT for profile routes.
	 */
	async login(req, res) {
		try {
			const { address, signature, referralCode } = req.body;
			if (!address) throw new Error("Wallet address is required");

			authService.verifySignature(address, signature);
			const user = await userModel.findOrCreateByAddress(address);
			if (user?.is_deleted) throw new Error("Account has been deleted");
			const token = authService.issueToken(address);

			res.json({ success: true, data: { token, user } });
		} catch (error) {
			res.status(401).json({ success: false, error: error.message });
		}
	}

	/**
	 * GET /api/auth/profile (protected)
	 * The caller's profile plus match stats and recent matches (cached).
	 */
	async getProfile(req, res) {
		try {
			const profile = await userModel.getUserProfile(req.user.address);
			if (!profile) return res.status(404).json({ success: false, error: "Profile not found" });
			res.json({ success: true, data: profile });
		} catch (error) {
			res.status(500).json({ success: false, error: error.message });
		}
	}

	/**
	 * GET /api/users/:address/profile (public)
	 * Any player's profile, stats and recent matches, for profile pages and
	 * leaderboards. Served from the Redis profile cache when available.
	 */
	async getPublicProfile(req, res) {
		try {
			const profile = await userModel.getUserProfile(req.params.address);
			if (!profile) return res.status(404).json({ success: false, error: "Profile not found" });
			res.json({ success: true, data: profile });
		} catch (error) {
			res.status(500).json({ success: false, error: error.message });
		}
	}

	/**
	 * PUT /api/auth/profile (protected) { username?, avatar_url?, bio?, country? }
	 */
	async updateProfile(req, res) {
		try {
			const user = await userModel.updateProfile(req.user.address, req.body || {});
			res.json({ success: true, data: user });
		} catch (error) {
			res.status(400).json({ success: false, error: error.message });
		}
	}

	/**
	 * POST /api/users/delete-account (protected) { signature }
	 * Requires a fresh deletion-purpose wallet signature before redacting PII.
	 */
	async deleteAccount(req, res) {
		try {
			const { signature } = req.body || {};
			const address = req.user.address;
			authService.verifySignature(address, signature, "delete-account");

			const result = await userModel.anonymizeUser(address);
			await sessionService.revokeAll(address);

			res.json({
				success: true,
				message: "Account data has been redacted",
				data: result,
			});
		} catch (error) {
			const status = /signature|challenge/i.test(error.message) ? 401 : 500;
			res.status(status).json({ success: false, error: error.message });
		}
	}
}

module.exports = new AuthController();
