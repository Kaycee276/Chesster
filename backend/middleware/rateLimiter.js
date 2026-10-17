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

/**
 * Tracks hit counts for a single key space within a fixed window, without
 * attaching HTTP semantics. Shared by `createAuthChallengeRateLimiter` so the
 * IP, subnet, and wallet-address windows can be checked independently before either
 * one writes a response.
 */
function createWindowCounter({ windowMs, max }) {
	const hits = new Map(); // key -> { count, resetAt }

	return {
		hit(key) {
			const now = Date.now();
			let entry = hits.get(key);

			if (!entry || now >= entry.resetAt) {
				entry = { count: 0, resetAt: now + windowMs };
				hits.set(key, entry);
			}

			entry.count += 1;

			return {
				exceeded: entry.count > max,
				retryAfterSec: Math.ceil((entry.resetAt - now) / 1000),
			};
		},
		reset() {
			hits.clear();
		},
	};
}

/**
 * Dual-tier rate limiting for the wallet auth challenge endpoint
 * (`POST /api/auth/challenge`), enforcing three independent caps:
 *   - `ipMax` requests per `windowMs` from a single IP address.
 *   - `subnetMax` requests per `windowMs` from all IPs in the same subnet
 *     (IPv4 /24 or IPv6 /48, with IPv4-mapped IPv6 unwrapped to /24).
 *   - `addressMax` pending challenge requests per `windowMs` for the same
 *     wallet address, regardless of source IP (skipped when no address is
 *     present on the request; the IP and subnet caps still apply).
 *
 * Semantics for counting:
 *   - Both IP and subnet counters increment on every request (before any rejection).
 *   - If the IP limit is exceeded, the request is rejected immediately; the
 *     subnet counter still incremented (abusive single IPs consume the shared budget).
 *   - If the subnet limit is exceeded (but IP limit not), the request is rejected.
 *   - If the address limit is exceeded (and both IP and subnet limits not),
 *     the request is rejected.
 *   - This ensures that one bad actor cannot trivially exhaust the entire subnet's
 *     budget for legitimate neighbors (by staying within the subnet but trying many
 *     addresses simultaneously).
 *
 * Responds with the structured 429 shape required by the auth challenge
 * contract: `{ error: 'Too Many Requests', retryAfter: <seconds> }`.
 */
function createAuthChallengeRateLimiter({
	windowMs = process.env.AUTH_RL_WINDOW_MS ? parseInt(process.env.AUTH_RL_WINDOW_MS, 10) : 60_000,
	ipMax = process.env.AUTH_RL_IP_MAX ? parseInt(process.env.AUTH_RL_IP_MAX, 10) : 10,
	subnetMax = process.env.AUTH_RL_SUBNET_MAX ? parseInt(process.env.AUTH_RL_SUBNET_MAX, 10) : 50,
	addressMax = process.env.AUTH_RL_ADDRESS_MAX ? parseInt(process.env.AUTH_RL_ADDRESS_MAX, 10) : 3,
	subnetKeyGenerator = null, // For testing; defaults to getSubnetFromIp
	addressGenerator = (req) => req.body?.address || req.query?.address,
} = {}) {
	// Lazy-load getSubnetFromIp to avoid circular dependency at module load time
	if (!subnetKeyGenerator) {
		subnetKeyGenerator = (ip) => {
			const { getSubnetFromIp } = require("./ipUtils");
			return getSubnetFromIp(ip);
		};
	}

	const ipCounter = createWindowCounter({ windowMs, max: ipMax });
	const subnetCounter = createWindowCounter({ windowMs, max: subnetMax });
	const addressCounter = createWindowCounter({ windowMs, max: addressMax });

	function reject(res, retryAfterSec) {
		res.set("Retry-After", String(retryAfterSec));
		return res.status(429).json({ error: "Too Many Requests", retryAfter: retryAfterSec });
	}

	function authChallengeRateLimiter(req, res, next) {
		const ipKey = req.ip || req.connection?.remoteAddress || "unknown";
		const subnetKey = subnetKeyGenerator(ipKey);

		// Check IP limit first
		const ipResult = ipCounter.hit(ipKey);
		if (ipResult.exceeded) {
			return reject(res, ipResult.retryAfterSec);
		}

		// Check subnet limit second
		const subnetResult = subnetCounter.hit(subnetKey);
		if (subnetResult.exceeded) {
			return reject(res, subnetResult.retryAfterSec);
		}

		// Check address limit third (if address is present)
		const address = addressGenerator(req);
		if (address) {
			const addressResult = addressCounter.hit(`addr:${address}`);
			if (addressResult.exceeded) {
				return reject(res, addressResult.retryAfterSec);
			}
		}

		return next();
	}

	authChallengeRateLimiter.reset = () => {
		ipCounter.reset();
		subnetCounter.reset();
		addressCounter.reset();
	};

	return authChallengeRateLimiter;
}

module.exports = { createRateLimiter, createAuthChallengeRateLimiter };
