/**
 * Tests for Global Exception Handling & Sentry Error Reporting Middleware
 */

const {
  errorHandler,
  installGlobalHandlers,
  isOperationalError,
  resolveStatusCode,
  buildResponse,
} = require("../middleware/errorHandler");
const logger = require("../utils/logger");

function mockReq(overrides = {}) {
  return {
    method: "GET",
    path: "/api/test",
    ip: "127.0.0.1",
    get: () => "test-agent",
    headers: {},
    ...overrides,
  };
}

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.headersSent = false;
  return res;
}

beforeEach(() => {
  logger.setCorrelationId("test-corr-id");
});

afterEach(() => {
  logger.clearContext();
});

describe("isOperationalError", () => {
  test("returns true for errors with isOperational flag", () => {
    const err = new Error("Not found");
    err.isOperational = true;
    expect(isOperationalError(err)).toBe(true);
  });

  test("returns true for errors with 4xx statusCode", () => {
    const err = new Error("Bad request");
    err.statusCode = 400;
    expect(isOperationalError(err)).toBe(true);
  });

  test("returns false for errors with 5xx statusCode", () => {
    const err = new Error("Server error");
    err.statusCode = 500;
    expect(isOperationalError(err)).toBe(false);
  });

  test("returns false for plain Error objects", () => {
    const err = new Error("Something broke");
    expect(isOperationalError(err)).toBe(false);
  });
});

describe("resolveStatusCode", () => {
  test("uses explicit statusCode when valid", () => {
    const err = new Error("Gone");
    err.statusCode = 410;
    expect(resolveStatusCode(err)).toBe(410);
  });

  test("maps JsonWebTokenError to 401", () => {
    const err = new Error("jwt malformed");
    err.name = "JsonWebTokenError";
    expect(resolveStatusCode(err)).toBe(401);
  });

  test("maps TokenExpiredError to 401", () => {
    const err = new Error("jwt expired");
    err.name = "TokenExpiredError";
    expect(resolveStatusCode(err)).toBe(401);
  });

  test("maps ValidationError to 400", () => {
    const err = new Error("invalid");
    err.name = "ValidationError";
    expect(resolveStatusCode(err)).toBe(400);
  });

  test("maps CastError to 400", () => {
    const err = new Error("bad id");
    err.name = "CastError";
    expect(resolveStatusCode(err)).toBe(400);
  });

  test("maps SyntaxError with body to 400", () => {
    const err = new SyntaxError("Unexpected token");
    err.body = {};
    expect(resolveStatusCode(err)).toBe(400);
  });

  test("maps ENOENT to 404", () => {
    const err = new Error("no such file");
    err.code = "ENOENT";
    expect(resolveStatusCode(err)).toBe(404);
  });

  test("defaults to 500 for unknown errors", () => {
    const err = new Error("unknown");
    expect(resolveStatusCode(err)).toBe(500);
  });
});

describe("buildResponse", () => {
  test("returns operational error message", () => {
    const err = new Error("User not found");
    err.isOperational = true;
    const body = buildResponse(err, 404, "corr-1");
    expect(body).toEqual({
      success: false,
      error: "User not found",
      statusCode: 404,
      correlationId: "corr-1",
    });
  });

  test("masks programming error messages", () => {
    const err = new Error("null pointer at line 342");
    const body = buildResponse(err, 500, "corr-2");
    expect(body).toEqual({
      success: false,
      error: "Internal server error",
      statusCode: 500,
      correlationId: "corr-2",
    });
  });

  test("omits correlationId when not provided", () => {
    const err = new Error("oops");
    err.isOperational = true;
    const body = buildResponse(err, 400);
    expect(body.correlationId).toBeUndefined();
  });
});

describe("errorHandler middleware", () => {
  test("sends operational error with original message", () => {
    const err = new Error("Game not found");
    err.isOperational = true;
    err.statusCode = 404;

    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: "Game not found",
        statusCode: 404,
      }),
    );
  });

  test("sends 500 with masked message for programming errors", () => {
    const err = new Error("Cannot read property 'map' of undefined");

    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: "Internal server error",
        statusCode: 500,
      }),
    );
  });

  test("delegates to next() when headers already sent", () => {
    const err = new Error("late error");

    const req = mockReq();
    const res = mockRes();
    res.headersSent = true;
    const next = jest.fn();

    errorHandler(err, req, res, next);

    expect(next).toHaveBeenCalledWith(err);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  test("includes correlationId in response", () => {
    const err = new Error("bad input");
    err.isOperational = true;

    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    errorHandler(err, req, res, next);

    const body = res.json.mock.calls[0][0];
    expect(body.correlationId).toBe("test-corr-id");
  });
});

describe("installGlobalHandlers", () => {
  let originalListeners;

  beforeEach(() => {
    originalListeners = {
      rejection: process.listenerCount("unhandledRejection"),
      exception: process.listenerCount("uncaughtException"),
    };
  });

  afterEach(() => {
    // Remove listeners added by installGlobalHandlers to avoid polluting other tests
    const rejectionListeners = process.listeners("unhandledRejection");
    process.removeAllListeners("unhandledRejection");
    rejectionListeners.slice(originalListeners.rejection).forEach((l) => {
      process.on("unhandledRejection", l);
    });

    const exceptionListeners = process.listeners("uncaughtException");
    process.removeAllListeners("uncaughtException");
    exceptionListeners.slice(originalListeners.exception).forEach((l) => {
      process.on("uncaughtException", l);
    });
  });

  test("registers listeners for unhandledRejection and uncaughtException", () => {
    const beforeRejection = process.listenerCount("unhandledRejection");
    const beforeException = process.listenerCount("uncaughtException");

    installGlobalHandlers();

    expect(process.listenerCount("unhandledRejection")).toBe(beforeRejection + 1);
    expect(process.listenerCount("uncaughtException")).toBe(beforeException + 1);
  });

  test("unhandledRejection listener does not throw", async () => {
    installGlobalHandlers();
    const rejectionListeners = process.listeners("unhandledRejection");
    const handler = rejectionListeners[rejectionListeners.length - 1];

    expect(() => handler(new Error("async boom"), Promise.resolve())).not.toThrow();
  });
});
