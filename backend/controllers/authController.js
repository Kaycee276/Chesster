const authService = require("../services/authService");
const userModel = require("../models/userModel");

class AuthController {
	/**
	 * POST /api/auth/challenge { address }
	 * Returns a one-time message the wallet must sign to prove ownership.
	 */
	async createChallenge(req, res) {
		try {
			const { address } = req.body;
			const message = authService.createChallenge(address);
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
			const { address, signature } = req.body;
			if (!address) throw new Error("Wallet address is required");

			authService.verifySignature(address, signature);
			const user = await userModel.findOrCreateByAddress(address);
			const token = authService.issueToken(address);

			res.json({ success: true, data: { token, user } });
		} catch (error) {
			res.status(401).json({ success: false, error: error.message });
		}
	}

	/**
	 * GET /api/auth/profile (protected)
	 */
	async getProfile(req, res) {
		try {
			const user = await userModel.getByAddress(req.user.address);
			res.json({ success: true, data: user });
		} catch (error) {
			res.status(404).json({ success: false, error: error.message });
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
}

module.exports = new AuthController();
