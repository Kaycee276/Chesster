/**
 * Transport security enforcement (Issue #143).
 *
 * In production the platform must only ever serve traffic over TLS: plain HTTP
 * requests are redirected to their HTTPS equivalent, insecure (non-`wss`)
 * WebSocket handshakes are rejected, and an HSTS header instructs browsers to
 * use HTTPS for future requests. The application typically runs behind a
 * TLS-terminating proxy (Render, Fly, Nginx, a load balancer), so the original
 * scheme is read from the standard `X-Forwarded-Proto` header, which requires
 * `app.set("trust proxy", ...)` to be configured on the Express app.
 *
 * All enforcement is gated on `NODE_ENV === "production"` so local HTTP
 * development and the existing test suite are unaffected. Setting
 * `DISABLE_HTTPS_REDIRECT=true` provides an explicit escape hatch for
 * deployments where an upstream layer already guarantees HTTPS.
 */

/**
 * Determine whether transport security should be enforced for the current
 * process. Enforcement is on in production unless explicitly disabled.
 *
 * @returns {boolean}
 */
function isEnforcementEnabled() {
	return (
		process.env.NODE_ENV === "production" &&
		process.env.DISABLE_HTTPS_REDIRECT !== "true"
	);
}

/**
 * Resolve the effective request scheme, preferring the proxy-supplied
 * `X-Forwarded-Proto` header (the first value if a comma-separated list) and
 * falling back to Express's own `req.protocol`.
 *
 * @param {import("express").Request} req
 * @returns {string} Lower-cased scheme, e.g. "https" or "http".
 */
function resolveProtocol(req) {
	const forwarded = req.headers["x-forwarded-proto"];
	if (typeof forwarded === "string" && forwarded.length > 0) {
		return forwarded.split(",")[0].trim().toLowerCase();
	}
	return (req.protocol || "").toLowerCase();
}

/**
 * Express middleware that enforces HTTPS in production. Secure requests are
 * annotated with an HSTS header and passed through; insecure GET/HEAD requests
 * are 301-redirected to the HTTPS URL; other insecure methods are refused with
 * 403 rather than silently redirected (a redirect would drop the request body).
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
function enforceHttps(req, res, next) {
	if (!isEnforcementEnabled()) return next();

	if (resolveProtocol(req) === "https") {
		// 1 year, apply to subdomains, allow preload-list inclusion.
		res.setHeader(
			"Strict-Transport-Security",
			"max-age=31536000; includeSubDomains; preload",
		);
		return next();
	}

	const host = req.headers.host;
	if ((req.method === "GET" || req.method === "HEAD") && host) {
		return res.redirect(301, `https://${host}${req.originalUrl}`);
	}

	return res.status(403).json({ error: "HTTPS is required" });
}

/**
 * Socket.io middleware factory that rejects insecure WebSocket handshakes in
 * production, guaranteeing all realtime traffic uses `wss`. The handshake's
 * scheme is taken from the same `X-Forwarded-Proto` header the HTTP layer uses.
 *
 * @returns {(socket: import("socket.io").Socket, next: (err?: Error) => void) => void}
 */
function enforceSecureSocket() {
	return (socket, next) => {
		if (!isEnforcementEnabled()) return next();

		const forwarded = socket.handshake.headers["x-forwarded-proto"];
		const proto =
			typeof forwarded === "string" && forwarded.length > 0
				? forwarded.split(",")[0].trim().toLowerCase()
				: socket.handshake.secure
					? "https"
					: "http";

		if (proto === "https") return next();

		return next(new Error("Secure WebSocket (wss) connection required"));
	};
}

module.exports = {
	enforceHttps,
	enforceSecureSocket,
	isEnforcementEnabled,
	resolveProtocol,
};
