const axios = require("axios");

function getRedisClientSafely() {
  try {
    const { getRedisClient } = require("../config/redis");
    return getRedisClient ? getRedisClient() : null;
  } catch (err) {
    return null;
  }
}

const TOR_EXIT_NODE_URL = "https://check.torproject.org/torbulkexitlist";
const REDIS_SET_KEY = "tor_exit_ips";
const TTL_SECONDS = 24 * 60 * 60; // 24 hours

// In-memory fallback set for testing and offline/local environments
const inMemoryTorIps = new Set();

/**
 * Normalizes IP strings (strips IPv6 mapped IPv4 prefix and port numbers)
 */
function normalizeIp(ip) {
  if (!ip || typeof ip !== "string") return "";
  let cleanIp = ip.trim();
  if (cleanIp.startsWith("::ffff:")) {
    cleanIp = cleanIp.substring(7);
  }
  if (cleanIp.includes(":") && cleanIp.includes(".")) {
    // Port attached to IPv4 (e.g. 1.2.3.4:5678)
    cleanIp = cleanIp.split(":")[0];
  }
  return cleanIp;
}

/**
 * Extract client IP from request headers or socket
 */
function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    const first = forwarded.split(",")[0].trim();
    if (first) return normalizeIp(first);
  }
  return normalizeIp(req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || "");
}

/**
 * Fetches latest public Tor exit node list and refreshes Redis / in-memory cache
 */
async function refreshTorExitList(customRedis = null) {
  try {
    const response = await axios.get(TOR_EXIT_NODE_URL, { timeout: 10000 });
    const ipList = response.data
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));

    inMemoryTorIps.clear();
    for (const ip of ipList) {
      inMemoryTorIps.add(ip);
    }

    const redis = customRedis || getRedisClientSafely();
    if (redis && typeof redis.sadd === "function") {
      try {
        if (ipList.length > 0) {
          const multi = redis.multi ? redis.multi() : null;
          if (multi) {
            multi.del(REDIS_SET_KEY);
            multi.sadd(REDIS_SET_KEY, ...ipList);
            multi.expire(REDIS_SET_KEY, TTL_SECONDS);
            await multi.exec();
          } else {
            await redis.del(REDIS_SET_KEY);
            await redis.sadd(REDIS_SET_KEY, ...ipList);
            await redis.expire(REDIS_SET_KEY, TTL_SECONDS);
          }
        }
      } catch (err) {
        console.warn("[ProxyDetection] Failed to update Redis tor_exit_ips set:", err.message);
      }
    }

    return { success: true, count: ipList.length };
  } catch (error) {
    console.warn("[ProxyDetection] Unable to fetch Tor exit list from source:", error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Check if an IP is a known Tor exit node
 */
async function isTorExitNode(ip, customRedis = null) {
  const cleanIp = normalizeIp(ip);
  if (!cleanIp) return false;

  if (inMemoryTorIps.has(cleanIp)) {
    return true;
  }

  const redis = customRedis || getRedisClientSafely();
  if (redis && typeof redis.sismember === "function") {
    try {
      const isMember = await redis.sismember(REDIS_SET_KEY, cleanIp);
      return isMember === 1 || isMember === true;
    } catch (err) {
      return inMemoryTorIps.has(cleanIp);
    }
  }

  return inMemoryTorIps.has(cleanIp);
}

/**
 * Add / Remove mock Tor IPs (useful for unit testing)
 */
function addMockTorIp(ip) {
  inMemoryTorIps.add(normalizeIp(ip));
}

function clearMockTorIps() {
  inMemoryTorIps.clear();
}

/**
 * Express Middleware: Tor & VPN Exit Node Detection on High-Stakes Wager Lobbies (Issue #326)
 */
function detectTorAndProxy(options = {}) {
  return async (req, res, next) => {
    try {
      const clientIp = getClientIp(req);
      const wagerAmount = req.body?.wagerAmount ?? req.body?.stake ?? 0;
      const isWager =
        options.enforceAlways ||
        Number(wagerAmount) > 0 ||
        req.body?.isWager === true ||
        Boolean(req.body?.tokenAddress && req.body.tokenAddress !== "none");

      // Free / casual practice games pass through unaffected
      if (!isWager) {
        return next();
      }

      const isTor = await isTorExitNode(clientIp, options.redis);
      if (isTor) {
        return res.status(403).json({
          error: "PROXY_DETECTED",
          message: "Tor and anonymized proxies are not permitted in wagered games.",
          ip: clientIp,
        });
      }

      return next();
    } catch (err) {
      console.error("[ProxyDetection] Error checking IP:", err);
      // Fail-open for unanticipated middleware internal errors on non-critical paths
      return next();
    }
  };
}

module.exports = {
  detectTorAndProxy,
  isTorExitNode,
  refreshTorExitList,
  addMockTorIp,
  clearMockTorIps,
  getClientIp,
  normalizeIp,
  inMemoryTorIps,
};
