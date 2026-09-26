/**
 * In-memory sliding-window rate limiter for Socket.io's raw engine handshake.
 *
 * Socket.io's HTTP upgrade handshake happens before a socket is ever
 * allocated, so a flood of connection attempts from a single IP can exhaust
 * file descriptors/memory before the usual Express `rateLimiter` middleware
 * (which only guards REST routes) ever gets a chance to run. This module is
 * meant to be attached directly to `io.engine` via `io.engine.use(...)`,
 * where requests are raw Node `http.IncomingMessage`/`http.ServerResponse`
 * objects rather than Express req/res, so it writes the 429 response itself
 * instead of relying on Express helpers.
 *
 * Not distributed — fine for a single backend instance, not for a
 * multi-node deployment without a shared store.
 */

const LOOPBACK_IPS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function getClientIp(req) {
	const forwarded = req.headers && req.headers["x-forwarded-for"];
	if (forwarded) return String(forwarded).split(",")[0].trim();
	return req.socket?.remoteAddress || req.connection?.remoteAddress || "unknown";
}

function createSocketRateLimiter({
	windowMs = 60_000,
	max = 30,
	message = "Too many connection attempts, please slow down.",
	// Loopback is whitelisted by default so local/CI integration tests that
	// open many sockets in quick succession aren't rate limited themselves.
	whitelist = LOOPBACK_IPS,
} = {}) {
	const hits = new Map(); // ip -> { count, resetAt }

	function socketRateLimiter(req, res, next) {
		const ip = getClientIp(req);

		if (whitelist.has(ip)) return next();

		const now = Date.now();
		let entry = hits.get(ip);

		if (!entry || now >= entry.resetAt) {
			entry = { count: 0, resetAt: now + windowMs };
			hits.set(ip, entry);
		}

		entry.count += 1;

		if (entry.count > max) {
			const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);
			res.writeHead(429, {
				"Content-Type": "application/json",
				"Retry-After": String(retryAfterSec),
			});
			res.end(JSON.stringify({ success: false, error: message }));
			return;
		}

		return next();
	}

	// Exposed for tests that need to reset internal state between cases
	// without waiting out the real window.
	socketRateLimiter.reset = () => hits.clear();

	return socketRateLimiter;
}

module.exports = { createSocketRateLimiter, getClientIp };
