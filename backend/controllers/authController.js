const authService = require("../services/authService");
const sessionService = require("../services/sessionService");
const userModel = require("../models/userModel");
const { getIpSubnetFromRequest } = require("../utils/ipUtils");
const jwt = require("jsonwebtoken");

function challengeBinding(req, uri) {
	// Validate in the service, after consuming a verification nonce. Missing
	// browser origins must never fall back to the service's trusted default.
	const origin = req.get("origin") || "null";
	return { origin, uri };
}

class AuthController {
	/** GET /api/auth/nonce?address=G...&uri=https://allowed.example/path */
	async generateNonce(req, res) {
		try {
			const data = await authService.generateAuthNonce(req.query.address, {
				...challengeBinding(req, req.query.uri), purpose: req.query.purpose ?? "login",
			});
			res.set("Cache-Control", "no-store");
			res.json({ success: true, data });
		} catch (error) {
			res.status(error.status || 400).json({ success: false, error: error.message });
		}
	}

	/** POST /api/auth/verify uses SEP-0043 HEX signatures by default. */
	async verify(req, res) {
		return authController._login(req, res, true);
	}

	/**
	 * POST /api/auth/challenge { address }
	 * Returns a one-time message the wallet must sign to prove ownership.
	 */
	async createChallenge(req, res) {
		try {
			const { address, purpose = "login" } = req.body;
			const message = await authService.createChallenge(address, purpose, challengeBinding(req, req.body.uri));
			res.set("Cache-Control", "no-store");
			res.json({ success: true, data: { message } });
		} catch (error) {
			res.status(error.status || 400).json({ success: false, error: error.message });
		}
	}

	/**
	 * POST /api/auth/login { address, signature }
	 * Verifies the signed challenge and issues a JWT for profile routes.
	 * On successful login, rotates the session token: old tokens are invalidated,
	 * and the new token is bound to the client's IP subnet.
	 */
	async login(req, res) {
		return authController._login(req, res, false);
	}

	async _login(req, res, siws) {
		try {
			const { address, signature, referralCode } = req.body;
			if (!address) throw new Error("Wallet address is required");

			const binding = challengeBinding(req, req.body.uri);
			if (siws) {
				await authService.verifySIWSSignature(address, req.body.message, signature, {
					...binding, requireMessage: true, signatureEncoding: req.body.signatureEncoding ?? "hex",
				});
			} else {
				await authService.verifySignature(address, signature, "login", binding);
			}
			const user = await userModel.findOrCreateByAddress(address);
			if (user?.is_deleted) throw new Error("Account has been deleted");

			// Get client IP subnet for binding
			const ipSubnet = getIpSubnetFromRequest(req);

			// Issue new token with IP binding
			const token = authService.issueToken(address, ipSubnet);

			// Decode token to get JTI and TTL
			const decoded = jwt.decode(token);
			const jti = decoded?.jti;
			const expiresAt = decoded?.exp;
			const ttlSeconds = expiresAt ? Math.ceil(expiresAt - Date.now() / 1000) : 604800; // Default 7 days

			// Rotate session: blacklist old JTI and store new one with IP binding
			if (jti && ttlSeconds > 0) {
				await sessionService.rotateSession(address, jti, ipSubnet, ttlSeconds);
			}

			res.set("Cache-Control", "no-store");
			res.json({ success: true, data: { token, user } });
		} catch (error) {
			res.status(error.status || 401).json({ success: false, error: error.message });
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
			res.status(error.status || 400).json({ success: false, error: error.message });
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
			await authService.verifySignature(address, signature, "delete-account", challengeBinding(req, req.body.uri));

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

const authController = new AuthController();
module.exports = authController;
