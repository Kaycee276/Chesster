const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "dev-only-insecure-secret-change-me";

/**
 * Express middleware that requires a valid JWT Bearer token.
 *
 * Verifies the `Authorization: Bearer <token>` header, and on success
 * attaches the decoded payload to `req.user` (at minimum `{ address }`,
 * the Stellar wallet address that authenticated — see authService.js).
 * On any failure it rejects the request with 401 and never calls next().
 */
function requireAuth(req, res, next) {
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
		req.user = { address: decoded.address || decoded.sub, ...decoded };
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
 */
function optionalAuth(req, res, next) {
	const header = req.headers["authorization"] || req.headers["Authorization"];
	if (!header || !header.startsWith("Bearer ")) return next();

	const token = header.slice("Bearer ".length).trim();
	if (!token) return next();

	try {
		const decoded = jwt.verify(token, JWT_SECRET);
		req.user = { address: decoded.address || decoded.sub, ...decoded };
	} catch (err) {
		// Ignore invalid/expired tokens on the optional path.
	}
	return next();
}

module.exports = { requireAuth, optionalAuth, JWT_SECRET };
