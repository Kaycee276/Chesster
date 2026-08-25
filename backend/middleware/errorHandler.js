/**
 * Global Exception Handling & Sentry Error Reporting Middleware
 *
 * Catches all unhandled errors thrown in Express routes/middleware, logs them
 * via the structured logger, reports them to Sentry when available, and
 * returns a consistent JSON error response to the client.
 *
 * Designed for Express 5 which automatically forwards rejected promises.
 */

const logger = require("../utils/logger");

let Sentry;
try {
  Sentry = require("@sentry/node");
} catch {
  Sentry = null;
}

/**
 * Check whether an error is operational (expected, user-facing) vs programming
 * (unexpected bug).
 *
 * Operational errors carry an `isOperational` flag or an explicit HTTP status
 * code set by the caller. Everything else is treated as a programming error.
 */
function isOperationalError(err) {
  return err.isOperational === true || (typeof err.statusCode === "number" && err.statusCode >= 400 && err.statusCode < 500);
}

/**
 * Map common error types to HTTP status codes.
 */
function resolveStatusCode(err) {
  if (typeof err.statusCode === "number" && err.statusCode >= 100 && err.statusCode < 600) {
    return err.statusCode;
  }
  if (err.name === "UnauthorizedError" || err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
    return 401;
  }
  if (err.name === "ValidationError" || err.name === "CastError") {
    return 400;
  }
  if (err.name === "SyntaxError" && typeof err.body !== "undefined") {
    return 400;
  }
  if (err.code === "ENOENT") {
    return 404;
  }
  // Operational errors without an explicit status code are likely client-facing
  // mistakes that should not surface as a generic 500.
  if (isOperationalError(err)) {
    return 400;
  }
  return 500;
}

/**
 * Build a consistent JSON error response body.
 */
function buildResponse(err, statusCode, correlationId) {
  const body = {
    success: false,
    error: isOperationalError(err) ? err.message : "Internal server error",
    statusCode,
  };
  if (correlationId) {
    body.correlationId = correlationId;
  }
  return body;
}

/**
 * Express global error-handling middleware (must have 4 parameters).
 *
 * IMPORTANT: This must be registered AFTER all routes so Express only invokes
 * it when no earlier handler called next(err) or sent a response.
 */
function errorHandler(err, req, res, _next) {
  const statusCode = resolveStatusCode(err);
  const correlationId = logger.getCorrelationId();

  // ---- Sentry --------------------------------------------------------
  if (Sentry && Sentry.captureException) {
    Sentry.captureException(err, {
      extra: {
        correlationId,
        method: req.method,
        path: req.path,
        statusCode,
      },
    });
  }

  // ---- Logging -------------------------------------------------------
  if (statusCode >= 500) {
    logger.error("Unhandled server error", {
      err,
      correlationId,
      method: req.method,
      path: req.path,
      statusCode,
    });
  } else {
    logger.warn("Client error", {
      errorMessage: err.message,
      correlationId,
      method: req.method,
      path: req.path,
      statusCode,
    });
  }

  // ---- Response ------------------------------------------------------
  if (res.headersSent) {
    // Headers already pushed – nothing we can do except delegate to the
    // default Express handler which will close the connection.
    return _next(err);
  }

  res.status(statusCode).json(buildResponse(err, statusCode, correlationId));
}

/**
 * Install global handlers for unhandled promise rejections and uncaught
 * exceptions so the process does not silently die in production.
 *
 * Call this once at application startup (typically in server.js).
 */
function installGlobalHandlers() {
  process.on("unhandledRejection", (reason, promise) => {
    logger.error("Unhandled promise rejection", {
      errorMessage: reason instanceof Error ? reason.message : String(reason),
      errorStack: reason instanceof Error ? reason.stack : undefined,
    });
    if (Sentry && Sentry.captureException) {
      Sentry.captureException(reason);
    }
  });

  process.on("uncaughtException", (err) => {
    logger.error("Uncaught exception – shutting down", { err });
    if (Sentry && Sentry.captureException) {
      Sentry.captureException(err);
    }
    // Give logger time to flush, then exit.
    setTimeout(() => process.exit(1), 500);
  });
}

module.exports = {
  errorHandler,
  installGlobalHandlers,
  isOperationalError,
  resolveStatusCode,
  buildResponse,
};
