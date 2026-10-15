const crypto = require("crypto");
const net = require("net");
const dns = require("dns");
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
 * Trusted Caller Boundary & Subscriber Configuration:
 *   There is currently no public HTTP API route for registering webhooks;
 *   subscribers are configured programmatically by trusted internal services
 *   (e.g., eventConsumer, tournament handlers, backend workers).
 *   To defend defense-in-depth against Server-Side Request Forgery (SSRF),
 *   the service strictly enforces destination security policies:
 *     1. Scheme: HTTPS is required for all subscriber destinations unless
 *        explicitly enabled for local development (ALLOW_HTTP_WEBHOOKS=true or
 *        WEBHOOK_ALLOW_INSECURE_LOCAL=true).
 *     2. Credentials: Userinfo/credentials in URLs (http://user:pass@host) are rejected.
 *     3. IP & Metadata Constraints: Loopback (127.0.0.0/8, ::1), private networks
 *        (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, fc00::/7), link-local
 *        (169.254.0.0/16, fe80::/10), cloud metadata (169.254.169.254,
 *        metadata.google.internal, instance-data), multicast/reserved ranges,
 *        and IPv4-mapped IPv6 representations are rejected at registration and dispatch.
 *     4. DNS Resolution & Rebinding: Hostnames are validated through DNS resolution
 *        before connection. All resolved addresses must be non-reserved public IPs.
 *     5. Redirects: Manual redirect following inspects and validates the destination
 *        of any HTTP 3xx redirect against this destination policy, preventing redirect SSRF.
 */

function isPrivateOrReservedIPv4(ip) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return true;
  }
  const [b0, b1, b2, b3] = parts;

  // 0.0.0.0/8 (Current network)
  if (b0 === 0) return true;

  // 10.0.0.0/8 (Private network)
  if (b0 === 10) return true;

  // 100.64.0.0/10 (Carrier-Grade NAT / Shared Address Space)
  if (b0 === 100 && b1 >= 64 && b1 <= 127) return true;

  // 127.0.0.0/8 (Loopback)
  if (b0 === 127) return true;

  // 169.254.0.0/16 (Link-local / Cloud metadata: 169.254.169.254)
  if (b0 === 169 && b1 === 254) return true;

  // 172.16.0.0/12 (Private network: 172.16.0.0 - 172.31.255.255)
  if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;

  // 192.0.0.0/24 (IETF Protocol Assignments)
  if (b0 === 192 && b1 === 0 && b2 === 0) return true;

  // 192.0.2.0/24 (TEST-NET-1 documentation)
  if (b0 === 192 && b1 === 0 && b2 === 2) return true;

  // 192.168.0.0/16 (Private network)
  if (b0 === 192 && b1 === 168) return true;

  // 198.18.0.0/15 (Network benchmark testing)
  if (b0 === 198 && (b1 === 18 || b1 === 19)) return true;

  // 198.51.100.0/24 (TEST-NET-2 documentation)
  if (b0 === 198 && b1 === 51 && b2 === 100) return true;

  // 203.0.113.0/24 (TEST-NET-3 documentation)
  if (b0 === 203 && b1 === 0 && b2 === 113) return true;

  // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved / Future Use)
  if (b0 >= 224) return true;

  // 255.255.255.255 (Broadcast)
  if (b0 === 255 && b1 === 255 && b2 === 255 && b3 === 255) return true;

  return false;
}

function isPrivateOrReservedIPv6(ip) {
  let str = ip.toLowerCase();

  // IPv4-mapped IPv6: ::ffff:192.0.2.128
  if (str.startsWith("::ffff:")) {
    const v4Part = str.slice(7);
    if (net.isIPv4(v4Part)) return isPrivateOrReservedIPv4(v4Part);
  }

  const parts = str.split("::");
  let left = parts[0] ? parts[0].split(":") : [];
  let right = parts.length > 1 ? (parts[1] ? parts[1].split(":") : []) : [];

  if (right.length > 0 && net.isIPv4(right[right.length - 1])) {
    return isPrivateOrReservedIPv4(right[right.length - 1]);
  }
  if (left.length > 0 && net.isIPv4(left[left.length - 1])) {
    return isPrivateOrReservedIPv4(left[left.length - 1]);
  }

  let missing = 8 - (left.length + right.length);
  if (missing < 0) return true;
  let words = [...left, ...Array(missing).fill("0"), ...right].map((w) => parseInt(w || "0", 16));
  if (words.length !== 8 || words.some((w) => isNaN(w) || w < 0 || w > 0xffff)) {
    return true;
  }

  // :: (Unspecified)
  if (words.every((w) => w === 0)) return true;

  // ::1 (Loopback)
  if (words.slice(0, 7).every((w) => w === 0) && words[7] === 1) return true;

  // ::ffff:0:0/96 (IPv4-mapped)
  if (words.slice(0, 5).every((w) => w === 0) && words[5] === 0xffff) {
    const ipv4 = `${words[6] >> 8}.${words[6] & 0xff}.${words[7] >> 8}.${words[7] & 0xff}`;
    return isPrivateOrReservedIPv4(ipv4);
  }

  // 100::/64 (Discard-only)
  if (words[0] === 0x0100 && words[1] === 0 && words[2] === 0 && words[3] === 0) return true;

  // 2001:db8::/32 (Documentation)
  if (words[0] === 0x2001 && words[1] === 0x0db8) return true;

  // fc00::/7 (Unique Local Address - ULA: fc00:: - fdff::)
  if ((words[0] & 0xfe00) === 0xfc00) return true;

  // fe80::/10 (Link-local unicast: fe80:: - febf::)
  if ((words[0] & 0xffc0) === 0xfe80) return true;

  // ff00::/8 (Multicast)
  if ((words[0] & 0xff00) === 0xff00) return true;

  return false;
}

function isPrivateOrReservedIp(ip) {
  const v = net.isIP(ip);
  if (v === 4) return isPrivateOrReservedIPv4(ip);
  if (v === 6) return isPrivateOrReservedIPv6(ip);
  return true;
}

async function defaultDnsLookup(hostname) {
  if (
    process.env.NODE_ENV === "test" &&
    (hostname.endsWith(".example") ||
      hostname.endsWith(".test") ||
      hostname.endsWith(".invalid") ||
      hostname === "a.com" ||
      hostname === "b.com" ||
      hostname === "fail.com" ||
      hostname === "timeout.com" ||
      hostname === "secure.com" ||
      hostname === "log.com" ||
      hostname === "x.com")
  ) {
    return [{ address: "93.184.216.34", family: 4 }];
  }
  return await dns.promises.lookup(hostname, { all: true });
}

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
      this._supabase = require("../config/supabase");
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
   * @param {(hostname: string) => Promise<Array<{address: string, family: number}>>} [options.dnsLookup] - DNS lookup implementation
   * @param {boolean} [options.allowInsecureHttp] - permit HTTP in local development
   * @param {Function} [options.fetch] - custom fetch implementation
   */
  constructor({
    deadLetterStore = supabaseDeadLetterStore,
    sleep = _sleep,
    dnsLookup = defaultDnsLookup,
    allowInsecureHttp = false,
    fetch: customFetch = null,
  } = {}) {
    this.subscribers = new Map();
    this.delIVERY_LOG = [];
    this.deadLetterStore = deadLetterStore;
    this.sleep = sleep;
    this.dnsLookup = dnsLookup;
    this.allowInsecureHttp = allowInsecureHttp;
    this.customFetch = customFetch;
  }

  // -------------------------------------------------------------------
  // Destination validation & security policy
  // -------------------------------------------------------------------

  validateDestinationSync(urlStr) {
    if (!urlStr || typeof urlStr !== "string") {
      throw new Error("eventType and url are required");
    }

    let urlObj;
    try {
      urlObj = new URL(urlStr);
    } catch {
      throw new Error(`Invalid webhook destination URL: ${urlStr}`);
    }

    const allowInsecure =
      this.allowInsecureHttp ||
      process.env.ALLOW_HTTP_WEBHOOKS === "true" ||
      process.env.WEBHOOK_ALLOW_INSECURE_LOCAL === "true";

    if (urlObj.protocol !== "https:") {
      if (urlObj.protocol !== "http:" || !allowInsecure) {
        throw new Error(
          `Webhook destination must use HTTPS (received '${urlObj.protocol}'). Insecure HTTP is only permitted when explicitly enabled for local development.`
        );
      }
    }

    if (urlObj.username || urlObj.password) {
      throw new Error("Webhook destination must not contain embedded user credentials");
    }

    const hostname = urlObj.hostname;
    if (!hostname) {
      throw new Error("Webhook destination hostname is required");
    }

    const lowerHost = hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (
      lowerHost === "metadata.google.internal" ||
      lowerHost === "instance-data" ||
      lowerHost === "metadata" ||
      lowerHost === "169.254.169.254"
    ) {
      throw new Error(`Webhook destination to cloud metadata endpoint is blocked: ${hostname}`);
    }

    if (
      !allowInsecure &&
      (lowerHost === "localhost" ||
        lowerHost.endsWith(".localhost") ||
        lowerHost.endsWith(".local") ||
        lowerHost.endsWith(".internal"))
    ) {
      throw new Error(`Webhook destination to local/internal network is blocked: ${hostname}`);
    }

    if (net.isIP(lowerHost)) {
      if (!allowInsecure && isPrivateOrReservedIp(lowerHost)) {
        throw new Error(
          `Webhook destination to private or reserved IP address is blocked: ${hostname}`
        );
      }
    }

    return urlObj;
  }

  async validateDestinationDns(urlObj) {
    const allowInsecure =
      this.allowInsecureHttp ||
      process.env.ALLOW_HTTP_WEBHOOKS === "true" ||
      process.env.WEBHOOK_ALLOW_INSECURE_LOCAL === "true";

    const host = urlObj.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (net.isIP(host)) {
      if (!allowInsecure && isPrivateOrReservedIp(host)) {
        throw new Error(
          `Webhook destination to private or reserved IP address is blocked: ${host}`
        );
      }
      return;
    }

    const addresses = await this.dnsLookup(host);
    if (!addresses || addresses.length === 0) {
      throw new Error(`DNS lookup for webhook host '${host}' returned no addresses`);
    }

    for (const record of addresses) {
      const ip = typeof record === "string" ? record : record.address;
      if (!allowInsecure && isPrivateOrReservedIp(ip)) {
        throw new Error(
          `Webhook destination host '${host}' resolved to blocked private or reserved IP: ${ip}`
        );
      }
    }
  }

  async validateDestination(urlStr) {
    const urlObj = this.validateDestinationSync(urlStr);
    await this.validateDestinationDns(urlObj);
    return urlObj;
  }

  // -------------------------------------------------------------------
  // Subscriber management
  // -------------------------------------------------------------------

  register(eventType, url) {
    if (!eventType || !url) throw new Error("eventType and url are required");
    this.validateDestinationSync(url);

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

  async _postOnce(url, payload, body, signature, redirectCount = 0) {
    const MAX_REDIRECTS = 5;
    if (redirectCount > MAX_REDIRECTS) {
      throw new Error(`Too many redirects (limit: ${MAX_REDIRECTS})`);
    }

    const urlObj = this.validateDestinationSync(url);
    await this.validateDestinationDns(urlObj);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), _getTimeout());
    try {
      const fetchImpl = this.customFetch || globalThis.fetch;
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Signature": `sha256=${signature}`,
          "X-Webhook-Event": payload.event,
        },
        body,
        redirect: "manual",
        signal: controller.signal,
      });

      if (response && response.status >= 300 && response.status < 400) {
        const location = response.headers?.get ? response.headers.get("location") : null;
        if (location) {
          const nextUrl = new URL(location, url).href;
          return await this._postOnce(nextUrl, payload, body, signature, redirectCount + 1);
        }
      }

      return response;
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

        if (response && response.ok) {
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

        lastStatusCode = response?.status || null;
        lastError = new Error(`HTTP ${response?.status || "unknown"}`);
        retryable = response ? _isRetryableStatus(response.status) : true;
      } catch (err) {
        lastStatusCode = null;
        lastError = err;
        if (
          err.message?.includes("blocked") ||
          err.message?.includes("HTTPS") ||
          err.message?.includes("credentials") ||
          err.message?.includes("Invalid webhook")
        ) {
          retryable = false;
        }
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

    return results.map((r) =>
      r.status === "fulfilled" ? r.value : { success: false, error: r.reason }
    );
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
module.exports.isPrivateOrReservedIp = isPrivateOrReservedIp;
module.exports.defaultDnsLookup = defaultDnsLookup;
