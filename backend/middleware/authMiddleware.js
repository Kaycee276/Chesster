const jwt = require("jsonwebtoken");
const sessionService = require("../services/sessionService");
const { getIpSubnetFromRequest } = require("../utils/ipUtils");

const JWT_SECRET = process.env.JWT_SECRET || "dev-only-insecure-secret-change-me";

/**
 * Express middleware that requires a valid JWT Bearer token.
 *
 * Verifies the `Authorization: Bearer <token>` header, and on success
 * attaches the decoded payload to `req.user` (at minimum `{ address }`,
 * the Stellar wallet address that authenticated — see authService.js).
 * 
 * Validates:
 * 1. Token signature and expiration
 * 2. JTI (JWT ID) is not blacklisted
 * 3. Request IP subnet matches token's bound IP subnet (if binding exists)
 * 
 * On any failure it rejects the request with 401 and never calls next().
 */
async function requireAuth(req, res, next) {
	const header = req.headers["authorization"] || req.headers["Authorization"];

	if (!header || !header.startsWith("Bearer ")) {
		return res.status(401).json({ success: false, error: "Missing or malformed Authorization header" });
	}

	const token = header.slice("Bearer ".length).trim();
	if (!token) {
		return res.status(401).json({ success: false, error: "Missing bearer token" });
	}

	try {
		const decoded = jwt.verify(token, JWT_SECRET);
		const address = decoded.address || decoded.sub;
		const jti = decoded.jti;

		// Check if token's IAT (issued-at) indicates revocation
		if (await sessionService.isTokenRevoked(address, decoded.iat)) {
			return res.status(401).json({ success: false, error: "Token revoked" });
		}

		// Check if JTI is blacklisted (e.g., from session rotation)
		if (jti && (await sessionService.isJtiBlacklisted(jti))) {
			return res.status(401).json({ success: false, error: "Session token invalidated" });
		}

		// Validate IP subnet binding if token has an ipSubnet claim
		const boundIpSubnet = decoded.ipSubnet;
		if (boundIpSubnet) {
			const currentIpSubnet = getIpSubnetFromRequest(req);
			if (!sessionService.isIpSubnetMatch(boundIpSubnet, currentIpSubnet)) {
				console.warn(
					`[AuthMiddleware] IP mismatch for ${address}: bound=${boundIpSubnet}, current=${currentIpSubnet}`,
				);
				return res.status(401).json({
					success: false,
					error: "Session IP mismatch - please re-authenticate",
				});
			}
		}

		req.user = { address, ...decoded };
		return next();
	} catch (err) {
		if (err.name === "TokenExpiredError") {
			return res.status(401).json({ success: false, error: "Token expired" });
		}
		return res.status(401).json({ success: false, error: "Invalid token" });
	}
}

/**
 * Like requireAuth, but does not reject unauthenticated requests — it just
 * attaches req.user when a valid token is present. Useful for routes that
 * behave differently for logged-in vs anonymous callers without requiring
 * auth outright.
 * 
 * Validates the same checks as requireAuth (JTI blacklist, IP binding).
 */
async function optionalAuth(req, res, next) {
	const header = req.headers["authorization"] || req.headers["Authorization"];
	if (!header || !header.startsWith("Bearer ")) return next();

	const token = header.slice("Bearer ".length).trim();
	if (!token) return next();

	try {
		const decoded = jwt.verify(token, JWT_SECRET);
		const address = decoded.address || decoded.sub;
		const jti = decoded.jti;

		// Check revocation status
		if (await sessionService.isTokenRevoked(address, decoded.iat)) {
			return next();
		}

		// Check JTI blacklist
		if (jti && (await sessionService.isJtiBlacklisted(jti))) {
			return next();
		}

		// Check IP binding
		const boundIpSubnet = decoded.ipSubnet;
		if (boundIpSubnet) {
			const currentIpSubnet = getIpSubnetFromRequest(req);
			if (!sessionService.isIpSubnetMatch(boundIpSubnet, currentIpSubnet)) {
				return next(); // Don't attach user on IP mismatch
			}
		}

		req.user = { address, ...decoded };
	} catch (err) {
		// Ignore invalid/expired tokens on the optional path.
	}
	return next();
}

module.exports = { requireAuth, optionalAuth, JWT_SECRET };
