/**
 * Tests for Structured Logger with Correlation IDs
 */

const logger = require("../utils/logger");
const fs = require("fs");
const path = require("path");

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
    expect(middleware.length).toBe(3); // (req, res, next)
  });

  test("should handle error logging with Error objects", () => {
    const error = new Error("Test error");
    const logEntry = logger.formatLogEntry("ERROR", "Something went wrong", {
      ...{ errorMessage: error.message, errorStack: error.stack, errorName: error.name }
    });
    
    expect(logEntry.level).toBe("ERROR");
    expect(logEntry.errorMessage).toBe("Test error");
    expect(logEntry).toHaveProperty("errorStack");
  });

  test("should log performance metrics", () => {
    const startTime = Date.now();
    const duration = 250;
    
    logger.setCorrelationId("perf-test");
    const logEntry = logger.formatLogEntry("PERFORMANCE", "Database query", {
      durationMs: duration,
      isSlowQuery: duration > 1000
    });
    
    expect(logEntry.level).toBe("PERFORMANCE");
    expect(logEntry.durationMs).toBe(250);
    expect(logEntry.isSlowQuery).toBe(false);
  });

  test("should clear context properly", () => {
    logger.setCorrelationId("test-id");
    logger.setRequestMetadata({ test: "data" });
    
    logger.clearContext();
    
    // After clear, a new ID should be generated
    const newId = logger.getCorrelationId();
    expect(newId).not.toBe("test-id");
    expect(logger.requestMetadata).toEqual({});
  });
});
