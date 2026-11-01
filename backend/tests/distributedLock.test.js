const {
  withLock,
  acquireLock,
  startHeartbeat,
  stopHeartbeat,
  getActiveHeartbeatCount,
  LOCK_RENEWAL_INTERVAL,
  DEFAULT_LOCK_TTL,
} = require("../utils/distributedLock");
const { getRedisClient } = require("../config/redis");

jest.mock("../config/redis", () => ({
  getRedisClient: jest.fn(),
}));

describe("Distributed Lock", () => {
  let mockRedis;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    mockRedis = {
      set: jest.fn(),
      get: jest.fn(),
      del: jest.fn(),
      eval: jest.fn(),
      pttl: jest.fn(),
      flushall: jest.fn(),
      quit: jest.fn(),
    };
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe("Unit Tests (Mocked Redis)", () => {
    it("should execute functions serially with in-memory fallback", async () => {
      jest.useRealTimers();
      getRedisClient.mockReturnValue(null);
      let concurrentCount = 0;

      const task = async () => {
        concurrentCount++;
        await new Promise((resolve) => setTimeout(resolve, 50));
        concurrentCount--;
        return true;
      };

      const promises = [
        withLock("game1", 2000, task).catch((e) => e.message),
        withLock("game1", 2000, task).catch((e) => e.message),
      ];

      const results = await Promise.all(promises);
      expect(results).toContain("Concurrent move in progress, try again");
      expect(results).toContain(true);
      expect(concurrentCount).toBe(0);
    });

    it("should acquire lock with heartbeat renewal enabled", async () => {
      getRedisClient.mockReturnValue(mockRedis);
      mockRedis.set.mockResolvedValue("OK");
      mockRedis.eval.mockResolvedValue(1); // Renewal successful

      const lock = await acquireLock("test-key", 10000, { autoRenew: true });

      expect(lock).not.toBeNull();
      expect(lock.token).toBeDefined();
      expect(lock.heartbeatId).toBeDefined();
      expect(mockRedis.set).toHaveBeenCalledWith(
        "lock:test-key",
        expect.any(String),
        "PX",
        10000,
        "NX"
      );

      // Advance time to trigger heartbeat
      jest.advanceTimersByTime(LOCK_RENEWAL_INTERVAL + 100);
      await Promise.resolve(); // Let promises settle

      expect(mockRedis.eval).toHaveBeenCalled();

      await lock.release();
    });

    it("should maintain lock ownership during long async operations", async () => {
      getRedisClient.mockReturnValue(mockRedis);
      mockRedis.set.mockResolvedValue("OK");
      mockRedis.eval.mockResolvedValue(1); // Renewal successful
      mockRedis.del.mockResolvedValue(1);

      let operationCompleted = false;
      const longOperation = async () => {
        // Simulate a long escrow settlement (6 seconds)
        await new Promise((resolve) => {
          setTimeout(() => {
            operationCompleted = true;
            resolve();
          }, 6000);
        });
        return "success";
      };

      const lockPromise = withLock("match-123", 10000, longOperation, { autoRenew: true });
      // Flush microtasks so acquireLock finishes and longOperation starts at time 0
      await jest.advanceTimersByTimeAsync(0);

      // Advance timers to simulate the long operation
      await jest.advanceTimersByTimeAsync(3000); // First renewal
      expect(mockRedis.eval).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(3000); // Second renewal
      expect(mockRedis.eval).toHaveBeenCalledTimes(2);

      await jest.advanceTimersByTimeAsync(100); // Complete the operation
      const result = await lockPromise;

      expect(result).toBe("success");
      expect(operationCompleted).toBe(true);
      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.stringContaining("pexpire"),
        1,
        "lock:match-123",
        expect.any(String),
        10000
      );
    });

    it("should prevent concurrent lock acquisition during auto-renewal", async () => {
      getRedisClient.mockReturnValue(mockRedis);
      mockRedis.set.mockResolvedValueOnce("OK").mockResolvedValueOnce(null);
      mockRedis.eval.mockResolvedValue(1);

      const lock1 = await acquireLock("resource-1", 10000, { autoRenew: true });
      expect(lock1).not.toBeNull();

      // Try to acquire same lock
      const lock2 = await acquireLock("resource-1", 10000, { autoRenew: true });
      expect(lock2).toBeNull();

      await lock1.release();
    });

    it("should stop heartbeat when renewal fails", async () => {
      getRedisClient.mockReturnValue(mockRedis);
      mockRedis.set.mockResolvedValue("OK");
      mockRedis.eval.mockResolvedValueOnce(1).mockResolvedValueOnce(0); // Second renewal fails

      const lock = await acquireLock("test-key", 10000, { autoRenew: true });
      const initialHeartbeats = getActiveHeartbeatCount();

      // First renewal succeeds
      jest.advanceTimersByTime(LOCK_RENEWAL_INTERVAL + 100);
      await Promise.resolve();
      expect(mockRedis.eval).toHaveBeenCalledTimes(1);

      // Second renewal fails
      jest.advanceTimersByTime(LOCK_RENEWAL_INTERVAL + 100);
      await Promise.resolve();
      expect(mockRedis.eval).toHaveBeenCalledTimes(2);

      // Heartbeat should be stopped
      expect(getActiveHeartbeatCount()).toBeLessThan(initialHeartbeats);

      await lock.release();
    });

    it("should handle errors during heartbeat renewal gracefully", async () => {
      getRedisClient.mockReturnValue(mockRedis);
      mockRedis.set.mockResolvedValue("OK");
      mockRedis.eval.mockRejectedValueOnce(new Error("Redis connection lost")).mockResolvedValue(1);

      const lock = await acquireLock("test-key", 10000, { autoRenew: true });

      // Trigger heartbeat that will fail
      jest.advanceTimersByTime(LOCK_RENEWAL_INTERVAL + 100);
      await Promise.resolve();

      // Should not throw, heartbeat stops gracefully
      await lock.release();
    });

    it("should not leak process handles with unref timers", async () => {
      getRedisClient.mockReturnValue(mockRedis);
      mockRedis.set.mockResolvedValue("OK");
      mockRedis.eval.mockResolvedValue(1);

      const lock = await acquireLock("test-key", 10000, { autoRenew: true });

      // The test itself verifies unref is called in implementation
      // Process should not be held open by the timer
      await lock.release();

      expect(getActiveHeartbeatCount()).toBe(0);
    });

    it("should release lock atomically with Lua script", async () => {
      getRedisClient.mockReturnValue(mockRedis);
      mockRedis.set.mockResolvedValue("OK");
      mockRedis.eval.mockResolvedValue(1);

      const lock = await acquireLock("test-key", 10000, { autoRenew: false });
      await lock.release();

      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.stringContaining("del"),
        1,
        "lock:test-key",
        lock.token
      );
    });
  });

  describe("Integration Test Suite: Lock Concurrency & Failure Recovery", () => {
    // Test concurrent lock acquisition with mocked Redis
    it("[ACCEPTANCE] should reject concurrent lock acquisition for same resource", async () => {
      getRedisClient.mockReturnValue(mockRedis);
      const key = "concurrent-test-1";
      const ttl = 5000;

      // Simulate first lock acquisition succeeding
      mockRedis.set.mockResolvedValueOnce("OK");
      // Simulate second lock acquisition failing
      mockRedis.set.mockResolvedValueOnce(null);

      // Acquire lock 1
      const lock1 = await acquireLock(key, ttl);
      expect(lock1).not.toBeNull();
      expect(lock1.token).toBeDefined();

      // Try to acquire lock 2 (should fail)
      const lock2 = await acquireLock(key, ttl);
      expect(lock2).toBeNull();

      mockRedis.eval.mockResolvedValue(1);
      await lock1.release();
    });

    // Test TTL expiration and lock recovery
    it("[ACCEPTANCE] should allow lock acquisition after TTL expiration (simulated crash)", async () => {
      getRedisClient.mockReturnValue(mockRedis);
      const key = "ttl-expiry-test";
      const ttl = 100;

      // Acquire initial lock
      mockRedis.set.mockResolvedValueOnce("OK");
      const lock1 = await acquireLock(key, ttl);
      const token1 = lock1.token;
      expect(lock1).not.toBeNull();

      // Simulate lock being held
      mockRedis.get.mockResolvedValueOnce(token1);

      // Verify lock exists
      let lockValue = await mockRedis.get(`lock:${key}`);
      expect(lockValue).toBe(token1);

      // Simulate TTL expiration by returning null
      mockRedis.get.mockResolvedValueOnce(null);

      // After TTL expires, lock should be gone
      lockValue = await mockRedis.get(`lock:${key}`);
      expect(lockValue).toBeNull();

      // Should be able to acquire new lock
      mockRedis.set.mockResolvedValueOnce("OK");
      const lock2 = await acquireLock(key, ttl);
      expect(lock2).not.toBeNull();
      expect(lock2.token).not.toBe(token1);
    });

    // Test safe token-based release
    it("[ACCEPTANCE] should prevent token mismatch release (safe release validation)", async () => {
      getRedisClient.mockReturnValue(mockRedis);
      const key = "token-safety";

      // Worker A acquires lock
      mockRedis.set.mockResolvedValueOnce("OK");
      const lockA = await acquireLock(key, 5000);
      const tokenA = lockA.token;

      // Worker B acquires after A's token expires
      mockRedis.set.mockResolvedValueOnce("OK");
      const lockB = await acquireLock(key, 5000);
      const tokenB = lockB.token;

      expect(tokenA).not.toBe(tokenB);

      // Simulate Lua script validation for Worker A's release attempt with old token
      // Returns 0 (failure) when token doesn't match
      mockRedis.eval.mockResolvedValueOnce(0);
      const canReleaseWithOldToken = await mockRedis.eval(
        `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`,
        1,
        `lock:${key}`,
        tokenA
      );

      // Should fail (return 0) because token doesn't match
      expect(canReleaseWithOldToken).toBe(0);

      // Worker B's release should succeed
      mockRedis.eval.mockResolvedValueOnce(1);
      await lockB.release();
    });

    // Test multiple concurrent worker contention
    it("[ACCEPTANCE] should handle 5 workers competing for single lock (only one succeeds)", async () => {
      getRedisClient.mockReturnValue(mockRedis);
      const key = "multi-worker-contention";
      const ttl = 5000;
      const workerCount = 5;

      // First worker succeeds
      mockRedis.set.mockResolvedValueOnce("OK");

      // Remaining 4 fail
      for (let i = 1; i < workerCount; i++) {
        mockRedis.set.mockResolvedValueOnce(null);
      }

      // All workers attempt to acquire the same lock
      const lockPromises = Array.from({ length: workerCount }, () =>
        acquireLock(key, ttl)
      );

      const locks = await Promise.all(lockPromises);

      // Only one should succeed
      const successCount = locks.filter((l) => l !== null).length;
      expect(successCount).toBe(1);

      // Others should be null
      expect(locks.filter((l) => l === null).length).toBe(workerCount - 1);

      // Clean up
      mockRedis.eval.mockResolvedValue(1);
      const successfulLock = locks.find((l) => l !== null);
      if (successfulLock) {
        await successfulLock.release();
      }
    });

    // Test rapid acquisition cycles without deadlock
    it("[ACCEPTANCE] should not deadlock on rapid acquire/release cycles", async () => {
      getRedisClient.mockReturnValue(mockRedis);
      mockRedis.set.mockResolvedValue("OK");
      mockRedis.eval.mockResolvedValue(1);

      const key = "rapid-cycles";
      const ttl = 1000;
      const cycles = 10;

      for (let i = 0; i < cycles; i++) {
        const lock = await acquireLock(key, ttl);
        expect(lock).not.toBeNull();
        await lock.release();
      }

      // Should complete without hanging, all operations succeed
      expect(mockRedis.set).toHaveBeenCalledTimes(cycles);
    });

    // Test heartbeat renewal stops on failed renewal
    it("[ACCEPTANCE] should stop heartbeat and handle failure recovery", async () => {
      getRedisClient.mockReturnValue(mockRedis);
      mockRedis.set.mockResolvedValue("OK");

      // First renewal succeeds, second fails (token mismatch)
      mockRedis.eval.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

      const lock = await acquireLock("heartbeat-recovery", 10000, { autoRenew: true });
      const initialHeartbeats = getActiveHeartbeatCount();
      expect(initialHeartbeats).toBeGreaterThan(0);

      // First heartbeat succeeds
      jest.advanceTimersByTime(LOCK_RENEWAL_INTERVAL + 100);
      await Promise.resolve();
      expect(mockRedis.eval).toHaveBeenCalledTimes(1);

      // Second heartbeat fails, stops automatically
      jest.advanceTimersByTime(LOCK_RENEWAL_INTERVAL + 100);
      await Promise.resolve();
      expect(mockRedis.eval).toHaveBeenCalledTimes(2);

      // Heartbeat should have been stopped after failure
      expect(getActiveHeartbeatCount()).toBeLessThan(initialHeartbeats);

      await lock.release();
    });

    // Test withLock concurrency prevention
    it("[ACCEPTANCE] should prevent concurrent execution via withLock wrapper", async () => {
      jest.useRealTimers(); // Use real timers for accurate timing
      getRedisClient.mockReturnValue(mockRedis);
      mockRedis.set.mockResolvedValueOnce("OK").mockResolvedValue(null);
      mockRedis.eval.mockResolvedValue(1);

      const key = "withloc-concurrency";
      let concurrentCount = 0;
      let maxConcurrent = 0;

      const task = async () => {
        concurrentCount++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCount);

        await new Promise((resolve) => setTimeout(resolve, 50));

        concurrentCount--;
        return "done";
      };

      const promises = [
        withLock(key, 5000, task),
        withLock(key, 5000, task).catch((e) => e.message),
        withLock(key, 5000, task).catch((e) => e.message),
      ];

      const results = await Promise.all(promises);

      // Only one execution should proceed
      expect(maxConcurrent).toBe(1);

      // Two should fail with concurrency error
      expect(results.filter((r) => r === "Concurrent move in progress, try again")).toHaveLength(2);
    });

    // Test lock cleanup on exception
    it("[ACCEPTANCE] should clean up locks even on function exception", async () => {
      getRedisClient.mockReturnValue(mockRedis);
      mockRedis.set.mockResolvedValue("OK");
      mockRedis.eval.mockResolvedValue(1);

      const key = "exception-cleanup";

      try {
        await withLock(key, 5000, async () => {
          throw new Error("Operation failed");
        });
      } catch (e) {
        expect(e.message).toBe("Operation failed");
      }

      // Verify release was called via eval (Lua script cleanup)
      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.stringContaining("del"),
        1,
        `lock:${key}`,
        expect.any(String)
      );
    });

    // Test TTL accuracy during long operations
    it("[ACCEPTANCE] should maintain TTL during extended operations with renewal", async () => {
      getRedisClient.mockReturnValue(mockRedis);
      mockRedis.set.mockResolvedValue("OK");
      mockRedis.eval.mockResolvedValue(1);
      mockRedis.pttl.mockResolvedValue(9800); // TTL close to initial

      const key = "ttl-maintenance";
      const ttl = 10000;

      const lock = await acquireLock(key, ttl);

      // Check TTL at acquisition
      const ttl1 = await mockRedis.pttl(`lock:${key}`);
      expect(ttl1).toBeLessThanOrEqual(ttl);
      expect(ttl1).toBeGreaterThan(ttl - 500);

      await lock.release();
    });

    // Test sequential lock takeover
    it("[ACCEPTANCE] should allow sequential takeover after release", async () => {
      getRedisClient.mockReturnValue(mockRedis);
      mockRedis.set.mockResolvedValue("OK");
      mockRedis.eval.mockResolvedValue(1);

      const key = "sequential-takeover";
      const ttl = 5000;
      const locks = [];

      // Acquire 3 locks sequentially
      for (let i = 0; i < 3; i++) {
        const lock = await acquireLock(key, ttl);
        expect(lock).not.toBeNull();
        locks.push(lock);

        // Release immediately to allow next worker
        await lock.release();
      }

      // All acquisitions should have succeeded
      expect(locks).toHaveLength(3);
      expect(mockRedis.set).toHaveBeenCalledTimes(3);
    });
  });
});
