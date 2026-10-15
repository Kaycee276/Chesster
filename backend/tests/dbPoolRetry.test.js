const { queryWithRetry, isTransientError, TRANSIENT_ERROR_CODES } = require("../config/db");
const db = require("../config/db");

describe("Database Connection Pooling Resilience & Jittered Retries", () => {
  describe("isTransientError", () => {
    test("should identify all required transient error codes", () => {
      const codes = ["ECONNRESET", "ETIMEDOUT", "EPIPE", "57P01", "57P02", "08006", "08001"];
      for (const code of codes) {
        expect(TRANSIENT_ERROR_CODES.has(code)).toBe(true);
        expect(isTransientError({ code, message: "Transient issue" })).toBe(true);
      }
    });

    test("should recognize transient network messages", () => {
      expect(isTransientError(new Error("Connection terminated unexpectedly"))).toBe(true);
      expect(isTransientError(new Error("read ECONNRESET"))).toBe(true);
      expect(isTransientError(new Error("server closed the connection unexpectedly"))).toBe(true);
      expect(isTransientError(new Error("terminating connection due to administrator command"))).toBe(true);
    });

    test("should fail immediately on non-transient errors like constraint violations or syntax errors", () => {
      const constraintError = new Error("duplicate key value violates unique constraint");
      constraintError.code = "23505";
      expect(isTransientError(constraintError)).toBe(false);

      const syntaxError = new Error("syntax error at or near 'SELECT'");
      syntaxError.code = "42601";
      expect(isTransientError(syntaxError)).toBe(false);

      expect(isTransientError(null)).toBe(false);
      expect(isTransientError(undefined)).toBe(false);
    });
  });

  describe("queryWithRetry", () => {
    test("should succeed immediately when query succeeds on first try", async () => {
      const mockPool = {
        query: jest.fn().mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 }),
      };

      const result = await queryWithRetry("SELECT 1", [], { pool: mockPool });
      expect(result.rows).toEqual([{ id: 1 }]);
      expect(mockPool.query).toHaveBeenCalledTimes(1);
    });

    test("should automatically recover from transient network drops and succeed on subsequent attempt", async () => {
      const transientErr = new Error("Connection terminated unexpectedly");
      transientErr.code = "ECONNRESET";

      const mockPool = {
        query: jest
          .fn()
          .mockRejectedValueOnce(transientErr)
          .mockRejectedValueOnce(transientErr)
          .mockResolvedValueOnce({ rows: [{ id: 42, username: "chess_master" }], rowCount: 1 }),
      };

      const result = await queryWithRetry("SELECT * FROM users WHERE id = $1", [42], {
        maxRetries: 3,
        backoffMs: 10,
        pool: mockPool,
      });

      expect(result.rows[0].username).toBe("chess_master");
      expect(mockPool.query).toHaveBeenCalledTimes(3);
    });

    test("should reject immediately without retry when error is non-transient (e.g. 23505 constraint violation)", async () => {
      const constraintErr = new Error("duplicate key value violates unique constraint 'users_pkey'");
      constraintErr.code = "23505";

      const mockPool = {
        query: jest.fn().mockRejectedValue(constraintErr),
      };

      await expect(
        queryWithRetry("INSERT INTO users (id) VALUES ($1)", [1], {
          maxRetries: 3,
          backoffMs: 10,
          pool: mockPool,
        })
      ).rejects.toThrow("duplicate key value violates unique constraint");

      // Non-transient errors must NOT be retried
      expect(mockPool.query).toHaveBeenCalledTimes(1);
    });

    test("should not retry mutating queries when isReadOnly is false", async () => {
      const transientErr = new Error("Connection terminated unexpectedly");
      transientErr.code = "ECONNRESET";

      const mockPool = {
        query: jest.fn().mockRejectedValue(transientErr),
      };

      await expect(
        queryWithRetry("UPDATE users SET status = 'active'", [], {
          maxRetries: 3,
          backoffMs: 10,
          isReadOnly: false,
          pool: mockPool,
        })
      ).rejects.toThrow("Connection terminated unexpectedly");

      // When isReadOnly is false, fail immediately without retry
      expect(mockPool.query).toHaveBeenCalledTimes(1);
    });

    test("should exhaust retries and throw error if transient failure persists beyond maxRetries", async () => {
      const transientErr = new Error("Connection terminated unexpectedly");
      transientErr.code = "ECONNRESET";

      const mockPool = {
        query: jest.fn().mockRejectedValue(transientErr),
      };

      await expect(
        queryWithRetry("SELECT 1", [], {
          maxRetries: 3,
          backoffMs: 10,
          pool: mockPool,
        })
      ).rejects.toThrow("Connection terminated unexpectedly");

      expect(mockPool.query).toHaveBeenCalledTimes(3);
    });

    test("QueryBuilder select uses queryWithRetry under the hood", async () => {
      const transientErr = new Error("Connection terminated unexpectedly");
      transientErr.code = "ECONNRESET";

      const originalGetPool = db.getPool;
      const mockPool = {
        query: jest
          .fn()
          .mockRejectedValueOnce(transientErr)
          .mockResolvedValueOnce({ rows: [{ id: 100, game_code: "XYZ" }], rowCount: 1 }),
      };

      db.getPool = () => mockPool;

      try {
        const { data, error } = await db.from("games").select("*").eq("id", 100);
        expect(error).toBeNull();
        expect(data).toEqual([{ id: 100, game_code: "XYZ" }]);
        expect(mockPool.query).toHaveBeenCalledTimes(2);
      } finally {
        db.getPool = originalGetPool;
      }
    });
  });
});
