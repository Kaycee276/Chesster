const { isIP } = require("node:net");
const proxyaddr = require("proxy-addr");
const { getRedisClient } = require("../config/redis");
const { normalizeIPv6 } = require("../utils/ipUtils");

// Refill and consume in one operation across all backend instances. Refresh
// the TTL on every attempt so inactive buckets disappear after one minute.
const CONSUME_TOKEN = `
local now = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
local window = tonumber(ARGV[3])
local bucket = redis.call('HMGET', KEYS[1], 'tokens', 'updatedAt')
local tokens = tonumber(bucket[1]) or capacity
local updated = tonumber(bucket[2]) or now
tokens = math.min(capacity, tokens + math.max(0, now - updated) * capacity / window)
local allowed = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
end
redis.call('HSET', KEYS[1], 'tokens', tokens, 'updatedAt', math.max(now, updated))
redis.call('PEXPIRE', KEYS[1], window)
return {allowed, math.max(0, math.ceil((1 - tokens) * window / capacity))}
`;

function normalizeIp(ip) {
	if (!isIP(ip || "")) return "unknown";
	if (isIP(ip) === 4) return ip;
	const normalized = normalizeIPv6(ip);
	if (normalized.startsWith("ipv4-mapped:")) return normalized.slice(12);
	// IPv4 mapped addresses also have a hexadecimal spelling.
	if (normalized.startsWith("0000:0000:0000:0000:0000:ffff:")) {
		const groups = normalized.split(":").slice(-2).map((part) => parseInt(part, 16));
		return [groups[0] >> 8, groups[0] & 255, groups[1] >> 8, groups[1] & 255].join(".");
	}
	return normalized;
}

function getClientIp(req, trustProxy = () => false) {
	let ip = req.socket?.remoteAddress || req.connection?.remoteAddress;
	if (ip && req.headers?.["x-forwarded-for"]) {
		try {
			ip = proxyaddr(req, trustProxy);
		} catch {
			// Malformed forwarding headers cannot create arbitrary bucket keys.
		}
	}
	return normalizeIp(ip);
}

/** Redis token bucket with a bounded LRU shadow for temporary outages. */
function createSocketRateLimiter({
	windowMs = 60_000,
	max = 30,
	maxEntries = 10_000,
	message = "Too many connection attempts",
	getRedis = getRedisClient,
	now = Date.now,
	trustedProxies = (process.env.TRUSTED_PROXIES || "").split(",").map((ip) => ip.trim()).filter(Boolean),
} = {}) {
	const trustProxy = trustedProxies.length ? proxyaddr.compile(trustedProxies) : () => false;
	const buckets = new Map();

	function consumeLocal(ip, timestamp) {
		let bucket = buckets.get(ip);
		if (!bucket || timestamp >= bucket.expiresAt) {
			bucket = { tokens: max, updatedAt: timestamp };
		}
		bucket.tokens = Math.min(max, bucket.tokens + Math.max(0, timestamp - bucket.updatedAt) * max / windowMs);
		const allowed = bucket.tokens >= 1;
		if (allowed) bucket.tokens -= 1;
		bucket.updatedAt = Math.max(timestamp, bucket.updatedAt);
		bucket.expiresAt = timestamp + windowMs;
		buckets.delete(ip);
		buckets.set(ip, bucket);
		if (buckets.size > maxEntries) buckets.delete(buckets.keys().next().value);
		return { allowed, retryAfterMs: Math.max(0, Math.ceil((1 - bucket.tokens) * windowMs / max)) };
	}

	async function checkHandshakeRateLimit(ip) {
		const timestamp = now();
		const local = consumeLocal(ip, timestamp);
		try {
			const redis = getRedis();
			if (redis) {
				const [allowed, retryAfterMs] = await redis.eval(CONSUME_TOKEN, 1, `ratelimit:ws_handshake:${ip}`, timestamp, max, windowMs);
				return { allowed: allowed === 1, retryAfterMs };
			}
		} catch {
			// Redis commands fail fast; use the shadow bucket during an outage.
		}
		return local;
	}

	async function socketRateLimiter(req, res, next) {
		// Existing polling requests and polling-to-WebSocket upgrades belong to
		// an already counted session. Invalid session IDs are rejected by Engine.IO.
		if (req._query?.sid) return next();
		const result = await checkHandshakeRateLimit(getClientIp(req, trustProxy));
		if (result.allowed) return next();
		const body = JSON.stringify({ success: false, error: message });
		const retryAfter = String(Math.max(1, Math.ceil(result.retryAfterMs / 1000)));
		if (req.headers?.upgrade?.toLowerCase() === "websocket") {
			// Engine.IO's upgrade response shim ignores writeHead and end destroys
			// the socket. Send the HTTP rejection before closing it instead.
			req.socket.end(`HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\nContent-Type: application/json\r\nRetry-After: ${retryAfter}\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
		} else {
			res.writeHead(429, { "Content-Type": "application/json", "Retry-After": retryAfter });
			res.end(body);
		}
	}

	socketRateLimiter.checkHandshakeRateLimit = checkHandshakeRateLimit;
	socketRateLimiter.reset = () => buckets.clear();
	return socketRateLimiter;
}

module.exports = { createSocketRateLimiter, getClientIp };
