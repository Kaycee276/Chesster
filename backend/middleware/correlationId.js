/**
 * Correlation ID middleware using AsyncLocalStorage
 * Provides per-request correlation IDs that are accessible throughout async call chains.
 */

const { AsyncLocalStorage } = require('node:async_hooks');
const crypto = require('crypto');

// Export the storage so other modules (e.g., logger) can retrieve the current correlationId.
const asyncLocalStorage = new AsyncLocalStorage();

/**
 * Express middleware that extracts or generates a correlation ID, stores it in AsyncLocalStorage,
 * and mirrors it back via response headers.
 *
 * It sets `req.id` and `req.correlationId` for downstream compatibility.
 */
function correlationMiddleware(req, res, next) {
  const correlationId =
    req.headers['x-request-id'] ||
    req.headers['x-correlation-id'] ||
    crypto.randomUUID();

  // Attach to request object for any legacy code that reads it directly.
  req.id = correlationId;
  req.correlationId = correlationId;

  // Echo back to the client.
  res.setHeader('X-Request-ID', correlationId);

  // Run downstream handlers within the AsyncLocalStorage context.
  asyncLocalStorage.run({ correlationId }, () => next());
}

module.exports = { asyncLocalStorage, correlationMiddleware };
