const crypto = require("crypto");
const logger = require("../utils/logger");

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
 * back-off plus jitter up to WEBHOOK_MAX_RETRIES attempts. Deliveries that
 * still fail are archived in the `webhook_dead_letter_queue` table and can be
 * replayed manually with replayDeadLetterWebhook(id).
 *
 * Follows the same in-memory singleton pattern used by AuthService /
 * TimerService — single-process, no external queue dependency.
 */

const EVENT_TYPES = {
  MATCH_CREATED: "match.created",
  MATCH_RESOLVED: "match.resolved",
  MATCH_PAYOUT_CONFIRMED: "match.payout_confirmed",
};

const DLQ_TABLE = "webhook_dead_letter_queue";

const DLQ_STATUS = {
  PENDING: "pending",
  REPLAYING: "replaying",
  REPLAYED: "replayed",
};

// 4xx responses that signal a transient condition and are worth retrying.
// Every other 4xx means the request itself was rejected, so retrying the
// identical payload cannot succeed and the delivery is dead-lettered at once.
const RETRYABLE_CLIENT_STATUSES = new Set([408, 425, 429]);

function _getSecret() {
  return process.env.WEBHOOK_SECRET || "";
}

function _getTimeout() {
  return Number(process.env.WEBHOOK_TIMEOUT_MS) || 5000;
}

function _getMaxRetries() {
  return Number(process.env.WEBHOOK_MAX_RETRIES) || 5;
}

function _getRetryDelay() {
  return Number(process.env.WEBHOOK_RETRY_DELAY_MS) || 1000;
}

function _getMaxRetryDelay() {
  return Number(process.env.WEBHOOK_MAX_RETRY_DELAY_MS) || 30000;
}

function _getRetryJitter() {
  const jitter = Number(process.env.WEBHOOK_RETRY_JITTER_MS);
  return Number.isFinite(jitter) && jitter >= 0 ? jitter : 500;
}

/**
 * Delay to wait after a failed attempt:
 *   min(maxDelayMs, baseDelayMs * 2^attempt + random jitter in [0, jitterMs))
 *
 * @param {number} attempt - 1-based number of the attempt that just failed
 */
function computeBackoffDelay(
  attempt,
  {
    baseDelayMs = _getRetryDelay(),
    maxDelayMs = _getMaxRetryDelay(),
    jitterMs = _getRetryJitter(),
    random = Math.random,
  } = {}
) {
  const exponential = baseDelayMs * Math.pow(2, attempt);
  return Math.min(maxDelayMs, exponential + random() * jitterMs);
}

function _isRetryableStatus(status) {
  return status >= 500 || RETRYABLE_CLIENT_STATUSES.has(status);
}

function _sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Default dead-letter persistence backed by Supabase. The client is created
 * lazily so the service can be loaded (and unit tested) without database
 * credentials. The table's RLS policy only admits the service role, so a
 * dedicated client is used when SUPABASE_SERVICE_ROLE_KEY is configured.
 */
const supabaseDeadLetterStore = {
  _supabase: null,

  _client() {
    if (!this._supabase) {
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      this._supabase = serviceKey
        ? require("@supabase/supabase-js").createClient(process.env.SUPABASE_URL, serviceKey, {
            auth: { persistSession: false },
          })
        : require("../config/supabase");
    }
    return this._supabase;
  },

  async insert(record) {
    const { data, error } = await this._client()
      .from(DLQ_TABLE)
      .insert(record)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data;
  },

  async findById(id) {
    const { data, error } = await this._client()
      .from(DLQ_TABLE)
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  },

  // Atomically moves a pending entry to "replaying" so concurrent replays of
  // the same entry cannot deliver it twice. Resolves null if not claimable.
  async claimForReplay(id) {
    const { data, error } = await this._client()
      .from(DLQ_TABLE)
      .update({ status: DLQ_STATUS.REPLAYING, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", DLQ_STATUS.PENDING)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  },

  async update(id, fields) {
    const { error } = await this._client()
      .from(DLQ_TABLE)
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(error.message);
  },
};

class WebhookService {
  /**
   * @param {object} [options]
   * @param {object} [options.deadLetterStore] - persistence for failed deliveries
   * @param {(ms: number) => Promise<void>} [options.sleep] - back-off timer
   */
  constructor({ deadLetterStore = supabaseDeadLetterStore, sleep = _sleep } = {}) {
    this.subscribers = new Map();
    this.delIVERY_LOG = [];
    this.deadLetterStore = deadLetterStore;
    this.sleep = sleep;
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

  async _postOnce(url, payload, body, signature) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), _getTimeout());
    try {
      return await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Signature": `sha256=${signature}`,
          "X-Webhook-Event": payload.event,
        },
        body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * POSTs the payload, retrying transient failures (network errors, timeouts,
   * 5xx, 408/425/429) with exponential back-off and jitter.
   *
   * Resolves with a delivery log entry; never throws for delivery failures.
   * When `deadLetter` is true, a delivery that ultimately fails is archived
   * in the dead-letter queue and the entry carries its `deadLetterId`.
   */
  async _deliverWithRetry(url, payload, { deadLetter = true } = {}) {
    const body = JSON.stringify(payload);
    const signature = this.sign(body);
    const maxAttempts = _getMaxRetries();
    let lastError = null;
    let lastStatusCode = null;
    let attempt = 0;

    while (attempt < maxAttempts) {
      attempt++;
      let retryable = true;

      try {
        const response = await this._postOnce(url, payload, body, signature);

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

        lastStatusCode = response.status;
        lastError = new Error(`HTTP ${response.status}`);
        retryable = _isRetryableStatus(response.status);
      } catch (err) {
        lastStatusCode = null;
        lastError = err;
      }

      if (!retryable) break;

      if (attempt < maxAttempts) {
        await this.sleep(computeBackoffDelay(attempt));
      }
    }

    const entry = {
      url,
      event: payload.event,
      success: false,
      statusCode: lastStatusCode,
      attempts: attempt,
      error: lastError ? lastError.message : "unknown",
      timestamp: Date.now(),
    };

    if (deadLetter) {
      entry.deadLetterId = await this._logToDeadLetterQueue(url, payload, entry);
    }

    this.delIVERY_LOG.push(entry);
    return entry;
  }

  // -------------------------------------------------------------------
  // Dead-letter queue
  // -------------------------------------------------------------------

  /**
   * Archives a permanently failed delivery. Persistence errors are logged and
   * swallowed so a database outage can never break webhook dispatch; the
   * failure is still visible in the delivery log.
   *
   * @returns {Promise<string|null>} the dead-letter entry id, or null
   */
  async _logToDeadLetterQueue(url, payload, failure) {
    try {
      const row = await this.deadLetterStore.insert({
        url,
        event_type: payload.event,
        payload,
        attempts: failure.attempts,
        last_error: failure.error,
        last_status_code: failure.statusCode,
        status: DLQ_STATUS.PENDING,
      });
      logger.warn("Webhook delivery moved to dead-letter queue", {
        deadLetterId: row.id,
        url,
        event: payload.event,
        attempts: failure.attempts,
        error: failure.error,
      });
      return row.id;
    } catch (err) {
      logger.error("Failed to write webhook to dead-letter queue", {
        url,
        event: payload.event,
        errorMessage: err.message,
      });
      return null;
    }
  }

  /**
   * Administrative manual retry of a dead-lettered webhook. The stored payload
   * is re-signed with the current secret and delivered with the normal retry
   * policy. On success the entry is marked "replayed"; on failure it returns
   * to "pending" with the latest error so it can be replayed again later.
   *
   * @param {string} id - webhook_dead_letter_queue row id
   * @returns {Promise<object>} the delivery log entry for the replay
   */
  async replayDeadLetterWebhook(id) {
    if (!id) throw new Error("Dead-letter webhook id is required");

    const claimed = await this.deadLetterStore.claimForReplay(id);
    if (!claimed) {
      const existing = await this.deadLetterStore.findById(id);
      if (!existing) throw new Error(`Dead-letter webhook ${id} not found`);
      throw new Error(`Dead-letter webhook ${id} is not pending (status: ${existing.status})`);
    }

    const replayCount = (claimed.replay_count || 0) + 1;
    const now = new Date().toISOString();
    let result;

    try {
      result = await this._deliverWithRetry(claimed.url, claimed.payload, { deadLetter: false });
    } catch (err) {
      // Release the claim so the entry is not stuck in "replaying"
      // (e.g. WEBHOOK_SECRET was unset and signing threw).
      await this.deadLetterStore.update(id, { status: DLQ_STATUS.PENDING });
      throw err;
    }

    if (result.success) {
      await this.deadLetterStore.update(id, {
        status: DLQ_STATUS.REPLAYED,
        replay_count: replayCount,
        last_replayed_at: now,
        replayed_at: now,
      });
    } else {
      await this.deadLetterStore.update(id, {
        status: DLQ_STATUS.PENDING,
        replay_count: replayCount,
        last_replayed_at: now,
        last_error: result.error,
        last_status_code: result.statusCode,
      });
    }

    return { ...result, deadLetterId: id };
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
module.exports.DLQ_STATUS = DLQ_STATUS;
module.exports.computeBackoffDelay = computeBackoffDelay;
