/**
 * Simple in-memory fixed-window rate limiter.
 *
 * Tracks request counts per key (IP by default) and rejects requests over
 * `max` within `windowMs` with a 429. Not distributed — fine for a single
 * backend instance, not for a multi-node deployment without a shared store.
 */
function createRateLimiter({
	windowMs = 60_000,
	max = 100,
	message = "Too many requests, please try again later.",
	keyGenerator = (req) => req.ip || req.connection?.remoteAddress || "unknown",
} = {}) {
	const hits = new Map(); // key -> { count, resetAt }

	function rateLimiter(req, res, next) {
		const key = keyGenerator(req);
		const now = Date.now();
		let entry = hits.get(key);

		if (!entry || now >= entry.resetAt) {
			entry = { count: 0, resetAt: now + windowMs };
			hits.set(key, entry);
		}

		entry.count += 1;

		res.set("X-RateLimit-Limit", String(max));
		res.set("X-RateLimit-Remaining", String(Math.max(0, max - entry.count)));

		if (entry.count > max) {
			const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);
			res.set("Retry-After", String(retryAfterSec));
			return res.status(429).json({ success: false, error: message });
		}

		return next();
	}

	// Exposed for tests that need to assert on internal state or force a reset
	// between cases without waiting out the real window.
	rateLimiter.reset = () => hits.clear();

	return rateLimiter;
}

module.exports = { createRateLimiter };
