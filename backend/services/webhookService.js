const crypto = require("crypto");

/**
 * WebhookService
 *
 * Dispatches signed HMAC SHA-256 HTTP webhooks on match lifecycle events:
 *   - match.created
 *   - match.resolved
 *   - match.payout_confirmed
 *
 * Each outgoing payload is signed with a shared secret so consumers can
 * verify authenticity. Failed deliveries are retried with exponential
 * back-off up to MAX_RETRIES attempts.
 *
 * Follows the same in-memory singleton pattern used by AuthService /
 * TimerService — single-process, no external queue dependency.
 */

const EVENT_TYPES = {
  MATCH_CREATED: "match.created",
  MATCH_RESOLVED: "match.resolved",
  MATCH_PAYOUT_CONFIRMED: "match.payout_confirmed",
};

function _getSecret() {
  return process.env.WEBHOOK_SECRET || "";
}

function _getTimeout() {
  return Number(process.env.WEBHOOK_TIMEOUT_MS) || 5000;
}

function _getMaxRetries() {
  return Number(process.env.WEBHOOK_MAX_RETRIES) || 3;
}

function _getRetryDelay() {
  return Number(process.env.WEBHOOK_RETRY_DELAY_MS) || 1000;
}

class WebhookService {
  constructor() {
    this.subscribers = new Map();
    this.delIVERY_LOG = [];
  }

  // -------------------------------------------------------------------
  // Subscriber management
  // -------------------------------------------------------------------

  register(eventType, url) {
    if (!eventType || !url) throw new Error("eventType and url are required");
    if (!this.subscribers.has(eventType)) {
      this.subscribers.set(eventType, new Set());
    }
    this.subscribers.get(eventType).add(url);
  }

  unregister(eventType, url) {
    const set = this.subscribers.get(eventType);
    if (set) set.delete(url);
  }

  getSubscribers() {
    const result = {};
    for (const [event, set] of this.subscribers) {
      result[event] = [...set];
    }
    return result;
  }

  // -------------------------------------------------------------------
  // Signature generation
  // -------------------------------------------------------------------

  sign(payload) {
    const secret = _getSecret();
    if (!secret) {
      throw new Error("WEBHOOK_SECRET is not configured");
    }
    return crypto.createHmac("sha256", secret).update(payload, "utf8").digest("hex");
  }

  verify(payload, signature) {
    const secret = _getSecret();
    if (!secret || !signature) return false;
    const expected = this.sign(payload);
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(signature, "hex");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  // -------------------------------------------------------------------
  // Dispatch
  // -------------------------------------------------------------------

  _buildPayload(eventType, data) {
    return {
      event: eventType,
      timestamp: new Date().toISOString(),
      data,
    };
  }

  async _deliverWithRetry(url, payload) {
    const body = JSON.stringify(payload);
    const signature = this.sign(body);
    const maxRetries = _getMaxRetries();
    const timeoutMs = _getTimeout();
    const retryDelay = _getRetryDelay();
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Webhook-Signature": `sha256=${signature}`,
            "X-Webhook-Event": payload.event,
          },
          body,
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (response.ok) {
          const entry = {
            url,
            event: payload.event,
            success: true,
            statusCode: response.status,
            attempts: attempt,
            timestamp: Date.now(),
          };
          this.delIVERY_LOG.push(entry);
          return entry;
        }

        lastError = new Error(`HTTP ${response.status}`);
      } catch (err) {
        lastError = err;
      }

      if (attempt < maxRetries) {
        const delay = retryDelay * Math.pow(2, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    const entry = {
      url,
      event: payload.event,
      success: false,
      statusCode: null,
      attempts: maxRetries,
      error: lastError ? lastError.message : "unknown",
      timestamp: Date.now(),
    };
    this.delIVERY_LOG.push(entry);
    return entry;
  }

  async dispatch(eventType, data) {
    const urls = this.subscribers.get(eventType);
    if (!urls || urls.size === 0) return [];

    const payload = this._buildPayload(eventType, data);

    const results = await Promise.allSettled(
      [...urls].map((url) => this._deliverWithRetry(url, payload))
    );

    return results.map((r) => (r.status === "fulfilled" ? r.value : { success: false, error: r.reason }));
  }

  // -------------------------------------------------------------------
  // Convenience helpers for the three match lifecycle events
  // -------------------------------------------------------------------

  async onMatchCreated(match) {
    return this.dispatch(EVENT_TYPES.MATCH_CREATED, match);
  }

  async onMatchResolved(match) {
    return this.dispatch(EVENT_TYPES.MATCH_RESOLVED, match);
  }

  async onPayoutConfirmed(payout) {
    return this.dispatch(EVENT_TYPES.MATCH_PAYOUT_CONFIRMED, payout);
  }

  // -------------------------------------------------------------------
  // Observability
  // -------------------------------------------------------------------

  getDeliveryLog() {
    return [...this.delIVERY_LOG];
  }

  clearDeliveryLog() {
    this.delIVERY_LOG = [];
  }
}

module.exports = new WebhookService();
module.exports.EVENT_TYPES = EVENT_TYPES;
module.exports.WebhookService = WebhookService;
