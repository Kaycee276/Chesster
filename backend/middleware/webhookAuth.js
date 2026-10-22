const express = require("express");
const { verifyWebhookSignature } = require("../services/webhookService");

/**
 * Raw body parser middleware for webhook ingress routes.
 * Enforces raw body capture preserving exact bytes for cryptographic HMAC validation.
 */
const rawBodyCapture = express.raw({ type: "application/json" });

/**
 * Validates the HMAC-SHA256 signature from request headers against the raw payload.
 */
function handleAuth(req, res, next, options = {}) {
  const signatureHeader = req.headers["x-chesster-signature"] || req.headers["x-webhook-signature"];

  if (!signatureHeader) {
    return res.status(401).json({
      success: false,
      error: "Missing webhook signature header (x-chesster-signature)",
    });
  }

  const secret = options.secret || process.env.WEBHOOK_SECRET;
  if (!secret) {
    return res.status(401).json({
      success: false,
      error: "Webhook secret is not configured",
    });
  }

  let rawBody;
  if (Buffer.isBuffer(req.rawBody)) {
    rawBody = req.rawBody;
  } else if (Buffer.isBuffer(req.body)) {
    rawBody = req.body;
  } else if (typeof req.rawBody === "string") {
    rawBody = req.rawBody;
  } else if (typeof req.body === "string") {
    rawBody = req.body;
  } else if (req.body && typeof req.body === "object") {
    try {
      rawBody = JSON.stringify(req.body);
    } catch {
      rawBody = "";
    }
  } else {
    rawBody = "";
  }

  const isValid = verifyWebhookSignature(rawBody, signatureHeader, secret);
  if (!isValid) {
    return res.status(401).json({
      success: false,
      error: "Invalid webhook signature",
    });
  }

  // If the body is currently a raw Buffer, parse it into JSON for downstream handlers
  if (Buffer.isBuffer(req.body)) {
    req.rawBody = req.body;
    try {
      req.body = JSON.parse(req.body.toString("utf8"));
    } catch {
      // Keep original buffer if non-JSON payload
    }
  }

  return next();
}

/**
 * Webhook HMAC-SHA256 Authentication Middleware (Issue #581)
 *
 * Enforces raw body capture and validates HMAC-SHA256 signatures on incoming webhook routes.
 * Rejects unauthenticated, tampered, or missing-signature requests with HTTP 401 Unauthorized.
 *
 * Usage:
 *   router.post('/webhook', webhookAuth, handler);
 *   router.post('/webhook', webhookAuth({ secret: 'mySecret' }), handler);
 *   router.post('/webhook', rawBodyCapture, webhookAuth, handler);
 */
function createWebhookAuth(options = {}) {
  return function webhookAuthMiddleware(req, res, next) {
    // If body has not been read yet and no raw body is captured, capture via rawBodyCapture
    if (req.body === undefined && !req.rawBody && typeof req.on === "function" && req.readable) {
      return rawBodyCapture(req, res, (err) => {
        if (err) return next(err);
        return handleAuth(req, res, next, options);
      });
    }

    return handleAuth(req, res, next, options);
  };
}

function webhookAuth(reqOrOptions, res, next) {
  if (typeof next === "function") {
    // Direct middleware invocation: webhookAuth(req, res, next)
    return createWebhookAuth({})(reqOrOptions, res, next);
  }
  // Factory invocation: webhookAuth(options)
  return createWebhookAuth(reqOrOptions || {});
}

webhookAuth.webhookAuth = webhookAuth;
webhookAuth.createWebhookAuth = createWebhookAuth;
webhookAuth.rawBodyCapture = rawBodyCapture;
webhookAuth.rawBodyParser = rawBodyCapture;
webhookAuth.verifyWebhookSignature = verifyWebhookSignature;

module.exports = webhookAuth;
