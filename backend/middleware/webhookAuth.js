const express = require("express");
const { verifyIngressSignature } = require("../services/webhookService");
const logger = require("../utils/logger");

const SIGNATURE_HEADER = "x-chesster-signature";
const MAX_WEBHOOK_BODY = process.env.WEBHOOK_MAX_BODY || "256kb";

/**
 * Captures the request body as a raw Buffer. The HMAC must be computed over the
 * exact bytes the sender signed, so JSON must not be parsed (and re-serialized)
 * before verification.
 */
const captureRawBody = express.raw({ type: "application/json", limit: MAX_WEBHOOK_BODY });

function reject(res) {
  return res.status(401).json({ success: false, error: "Invalid webhook signature" });
}

/**
 * Verifies the x-chesster-signature header against the raw body and
 * WEBHOOK_SECRET, then exposes the parsed payload as req.body (Issue #581).
 * Supports dual-secret rotation (Issue #702) for zero-downtime key rotation:
 * attempts primary secret first, then secondary if configured.
 * Missing headers, missing secrets, altered payloads and bad signatures all
 * return 401 with an identical response so callers learn nothing about why.
 */
function verifySignature(req, res, next) {
  const rawBody = req.body;
  if (!Buffer.isBuffer(rawBody)) {
    // No body, or a content type other than application/json.
    return reject(res);
  }

  const primarySecret = process.env.WEBHOOK_SECRET_PRIMARY || process.env.WEBHOOK_SECRET;
  const secondarySecret = process.env.WEBHOOK_SECRET_SECONDARY;

  if (!primarySecret && !secondarySecret) {
    logger.error("[webhookAuth] Neither WEBHOOK_SECRET_PRIMARY nor WEBHOOK_SECRET_SECONDARY is configured; rejecting inbound webhook");
    return reject(res);
  }

  const signature = req.headers[SIGNATURE_HEADER];
  let verified = false;

  if (primarySecret && verifyIngressSignature(rawBody, signature, primarySecret)) {
    verified = true;
  } else if (secondarySecret && verifyIngressSignature(rawBody, signature, secondarySecret)) {
    logger.info("[webhookAuth] Request authenticated using secondary rotated secret");
    verified = true;
  }

  if (!verified) {
    return reject(res);
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch (_) {
    return res.status(400).json({ success: false, error: "Malformed JSON payload" });
  }

  req.rawBody = rawBody;
  req.body = payload;
  return next();
}

/** Middleware chain for webhook ingress routes: raw capture then verification. */
const webhookAuth = [captureRawBody, verifySignature];

module.exports = { webhookAuth, verifySignature, captureRawBody, SIGNATURE_HEADER };
