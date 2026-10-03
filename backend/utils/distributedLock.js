const { getRedisClient } = require("../config/redis");

const inMemoryLocks = new Map();

async function withLock(key, ttlMs, fn) {
  const redis = getRedisClient();
  const lockKey = `lock:${key}`;
  const token = Math.random().toString(36).substring(2);

  if (redis) {
    const acquired = await redis.set(lockKey, token, 'PX', ttlMs, 'NX');
    if (!acquired) throw new Error('Concurrent move in progress, try again');
    try {
      return await fn();
    } finally {
      const current = await redis.get(lockKey);
      if (current === token) {
        await redis.del(lockKey);
      }
    }
  } else {
    // In-memory fallback
    if (inMemoryLocks.has(lockKey)) {
      throw new Error('Concurrent move in progress, try again');
    }
    inMemoryLocks.set(lockKey, token);
    
    // Auto-expire fallback
    const timeout = setTimeout(() => {
      if (inMemoryLocks.get(lockKey) === token) {
        inMemoryLocks.delete(lockKey);
      }
    }, ttlMs);
    
    try {
      return await fn();
    } finally {
      clearTimeout(timeout);
      if (inMemoryLocks.get(lockKey) === token) {
        inMemoryLocks.delete(lockKey);
      }
    }
  }
}

module.exports = { withLock };
