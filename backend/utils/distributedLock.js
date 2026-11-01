const { getRedisClient } = require("../config/redis");

const inMemoryLocks = new Map();
const activeHeartbeats = new Map();

// Configuration
const LOCK_RENEWAL_INTERVAL = 3000; // Renew every 3 seconds
const DEFAULT_LOCK_TTL = 10000; // 10 second default TTL

// Lua script for atomic lock renewal
const renewLockScript = `
if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('pexpire', KEYS[1], ARGV[2])
else
    return 0
end
`;

// Lua script for atomic lock release
const releaseLockScript = `
if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
else
    return 0
end
`;

/**
 * Start heartbeat renewal for a distributed lock
 * @param {Object} redis - Redis client
 * @param {string} lockKey - Lock key in Redis
 * @param {string} token - Unique lock token
 * @param {number} ttlMs - TTL in milliseconds
 * @returns {string} heartbeatId - Unique identifier for this heartbeat
 */
function startHeartbeat(redis, lockKey, token, ttlMs) {
  const heartbeatId = `${lockKey}:${token}`;

  if (activeHeartbeats.has(heartbeatId)) {
    return heartbeatId; // Already running
  }

  const intervalId = setInterval(async () => {
    try {
      const renewed = await redis.eval(renewLockScript, 1, lockKey, token, ttlMs);

      if (!renewed) {
        console.warn(`[DistributedLock] Lock renewal failed for ${lockKey}, token no longer valid`);
        stopHeartbeat(heartbeatId);
      }
    } catch (error) {
      console.error(`[DistributedLock] Heartbeat renewal error for ${lockKey}:`, error.message);
      stopHeartbeat(heartbeatId);
    }
  }, LOCK_RENEWAL_INTERVAL);

  // Unref to prevent blocking process exit
  if (typeof intervalId.unref === "function") {
    intervalId.unref();
  }

  activeHeartbeats.set(heartbeatId, { intervalId, lockKey, token });
  return heartbeatId;
}

/**
 * Stop heartbeat renewal
 * @param {string} heartbeatId - Heartbeat identifier
 */
function stopHeartbeat(heartbeatId) {
  const heartbeat = activeHeartbeats.get(heartbeatId);
  if (heartbeat) {
    clearInterval(heartbeat.intervalId);
    activeHeartbeats.delete(heartbeatId);
  }
}

/**
 * Acquire a distributed lock with optional auto-renewal
 * @param {string} key - Lock identifier
 * @param {number} ttlMs - Lock TTL in milliseconds
 * @param {Object} options - Options object
 * @param {boolean} options.autoRenew - Enable automatic lease renewal
 * @returns {Object} Lock handle with token and release function
 */
async function acquireLock(key, ttlMs = DEFAULT_LOCK_TTL, options = {}) {
  const { autoRenew = false } = options;
  const redis = getRedisClient();
  const lockKey = `lock:${key}`;
  const token = `${Date.now()}-${Math.random().toString(36).substring(2)}`;

  if (redis) {
    const acquired = await redis.set(lockKey, token, "PX", ttlMs, "NX");
    if (!acquired) {
      return null; // Lock already held
    }

    let heartbeatId = null;
    if (autoRenew) {
      heartbeatId = startHeartbeat(redis, lockKey, token, ttlMs);
    }

    return {
      token,
      lockKey,
      heartbeatId,
      release: async () => {
        if (heartbeatId) {
          stopHeartbeat(heartbeatId);
        }
        await redis.eval(releaseLockScript, 1, lockKey, token);
      },
    };
  } else {
    // In-memory fallback
    if (inMemoryLocks.has(lockKey)) {
      return null; // Lock already held
    }

    inMemoryLocks.set(lockKey, token);

    // Auto-expire fallback (no heartbeat in memory mode)
    const timeout = setTimeout(() => {
      if (inMemoryLocks.get(lockKey) === token) {
        inMemoryLocks.delete(lockKey);
      }
    }, ttlMs);

    if (typeof timeout.unref === "function") {
      timeout.unref();
    }

    return {
      token,
      lockKey,
      heartbeatId: null,
      release: async () => {
        clearTimeout(timeout);
        if (inMemoryLocks.get(lockKey) === token) {
          inMemoryLocks.delete(lockKey);
        }
      },
    };
  }
}

/**
 * Execute a function with distributed lock protection and auto-renewal
 * @param {string} key - Lock identifier
 * @param {number} ttlMs - Lock TTL in milliseconds
 * @param {Function} fn - Function to execute
 * @param {Object} options - Options object
 * @param {boolean} options.autoRenew - Enable automatic lease renewal for long operations
 * @returns {*} Result of fn()
 */
async function withLock(key, ttlMs, fn, options = {}) {
  const lock = await acquireLock(key, ttlMs, options);

  if (!lock) {
    throw new Error("Concurrent move in progress, try again");
  }

  try {
    return await fn();
  } finally {
    await lock.release();
  }
}

/**
 * Get active heartbeat count (for monitoring/debugging)
 */
function getActiveHeartbeatCount() {
  return activeHeartbeats.size;
}

module.exports = {
  withLock,
  acquireLock,
  startHeartbeat,
  stopHeartbeat,
  getActiveHeartbeatCount,
  LOCK_RENEWAL_INTERVAL,
  DEFAULT_LOCK_TTL,
};
