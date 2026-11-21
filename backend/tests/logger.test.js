/**
 * Tests for Structured Logger with Correlation IDs
 */

const logger = require("../utils/logger");
const { correlationMiddleware, asyncLocalStorage } = require("../middleware/correlationId");

describe("Structured Logger", () => {
  beforeEach(() => {
    logger.clearContext();
  });

  afterAll(() => {
    logger.clearContext();
  });

  test("should generate unique correlation IDs", () => {
    const id1 = logger.generateId();
    const id2 = logger.generateId();
    expect(id1).toBeTruthy();
    expect(id2).toBeTruthy();
    expect(id1).not.toBe(id2);
  });

  test("should set and retrieve correlation ID", () => {
    const correlationId = "test-correlation-id-123";
    logger.setCorrelationId(correlationId);
    expect(logger.getCorrelationId()).toBe(correlationId);
  });

  test("should format log entries correctly", () => {
    logger.setCorrelationId("test-id");
    const testData = { userId: 123, action: "login" };
    const logEntry = logger.formatLogEntry("INFO", "User logged in", testData);
    expect(logEntry).toHaveProperty("timestamp");
    expect(logEntry).toHaveProperty("service", "Chesster-Backend");
    expect(logEntry).toHaveProperty("level", "INFO");
    expect(logEntry).toHaveProperty("correlationId", "test-id");
    expect(logEntry).toHaveProperty("message", "User logged in");
    expect(logEntry).toHaveProperty("userId", 123);
  });

  test("should set and retrieve request metadata", () => {
    const metadata = { method: "POST", path: "/api/games" };
    logger.setRequestMetadata(metadata);
    const logEntry = logger.formatLogEntry("INFO", "test");
    expect(logEntry).toHaveProperty("method", "POST");
    expect(logEntry).toHaveProperty("path", "/api/games");
  });

  test("should create valid Express middleware", () => {
    const middleware = logger.requestMiddleware();
    expect(typeof middleware).toBe("function");
    expect(middleware.length).toBe(3);
  });

  test("should handle error logging with Error objects", () => {
    const error = new Error("Test error");
    const logEntry = logger.formatLogEntry("ERROR", "Something went wrong", {
      errorMessage: error.message,
      errorStack: error.stack,
      errorName: error.name,
    });
    expect(logEntry.level).toBe("ERROR");
    expect(logEntry.errorMessage).toBe("Test error");
    expect(logEntry).toHaveProperty("errorStack");
  });

  test("should log performance metrics", () => {
    const duration = 250;
    const logEntry = logger.formatLogEntry("PERFORMANCE", "Database query", {
      durationMs: duration,
      isSlowQuery: duration > 1000,
    });
    expect(logEntry.level).toBe("PERFORMANCE");
    expect(logEntry.durationMs).toBe(250);
    expect(logEntry.isSlowQuery).toBe(false);
  });

  test("should clear context properly", () => {
    logger.setCorrelationId("test-id");
    logger.setRequestMetadata({ test: "data" });
    logger.clearContext();
    const newId = logger.getCorrelationId();
    expect(newId).not.toBe("test-id");
    expect(logger.requestMetadata).toEqual({});
  });

  // Correlation middleware tests
  test("correlationMiddleware generates UUID and sets headers", () => {
    const req = { headers: {} };
    const res = { setHeader: jest.fn() };
    const next = jest.fn();
    correlationMiddleware(req, res, next);
    expect(req.id).toBeDefined();
    expect(req.correlationId).toBe(req.id);
    expect(res.setHeader).toHaveBeenCalledWith("X-Request-ID", req.id);
    expect(next).toHaveBeenCalled();
  });

  test("correlationMiddleware preserves incoming X-Request-ID", () => {
    const existing = "existing-id";
    const req = { headers: { "x-request-id": existing } };
    const res = { setHeader: jest.fn() };
    const next = jest.fn();
    correlationMiddleware(req, res, next);
    expect(req.id).toBe(existing);
    expect(res.setHeader).toHaveBeenCalledWith("X-Request-ID", existing);
    expect(next).toHaveBeenCalled();
  });

  test("logger retrieves correlationId from AsyncLocalStorage", async () => {
    const ids = [];
    await Promise.all([
      new Promise((resolve) => {
        asyncLocalStorage.run({ correlationId: "id-1" }, () => {
          const entry = logger.formatLogEntry("INFO", "test1");
          ids.push(entry.correlationId);
          resolve();
        });
      }),
      new Promise((resolve) => {
        asyncLocalStorage.run({ correlationId: "id-2" }, () => {
          const entry = logger.formatLogEntry("INFO", "test2");
          ids.push(entry.correlationId);
          resolve();
        });
      }),
    ]);
    expect(ids).toContain("id-1");
    expect(ids).toContain("id-2");
  });
});
