const Redis = require("ioredis");

/**
 * Optional Redis connection used as a read-through cache (Issue #247).
 *
 * Caching is enabled only when REDIS_URL is set. getRedisClient() hands out
 * the client only while it is connected, and commands fail fast instead of
 * queueing while Redis is down, so callers can always fall back to
 * PostgreSQL without adding latency.
 */
let client = null;
let reportedDown = false;

function createClient(url) {
	const redis = new Redis(url, {
		enableOfflineQueue: false,
		maxRetriesPerRequest: 1,
		connectTimeout: 2000,
		// Keep reconnecting in the background, backing off up to 10s.
		retryStrategy: (attempt) => Math.min(attempt * 500, 10000),
	});

	redis.on("ready", () => {
		if (reportedDown) console.info("[Redis] connection restored; profile caching re-enabled");
		reportedDown = false;
	});
	redis.on("error", (err) => {
		if (!reportedDown) {
			console.warn(`[Redis] unavailable (${err.message}); serving from the database until it recovers`);
			reportedDown = true;
		}
	});

	return redis;
}

/** The connected Redis client, or null when caching is disabled or Redis is down. */
function getRedisClient() {
	if (!process.env.REDIS_URL) return null;
	if (!client) client = createClient(process.env.REDIS_URL);
	return client.status === "ready" ? client : null;
}

/** Close the connection (graceful shutdown / tests). */
async function closeRedis() {
	if (!client) return;
	const redis = client;
	client = null;
	try {
		await redis.quit();
	} catch (_) {
		redis.disconnect();
	}
}

module.exports = { getRedisClient, closeRedis };
