process.env.WEBHOOK_SECRET = "test-webhook-secret-key";
process.env.WEBHOOK_TIMEOUT_MS = "1000";
process.env.WEBHOOK_MAX_RETRIES = "2";
process.env.WEBHOOK_RETRY_DELAY_MS = "50";

jest.mock("../config/supabase", () => ({ from: jest.fn() }));
jest.mock("@supabase/supabase-js", () => ({
  createClient: jest.fn(() => ({ from: jest.fn() })),
}));

const {
  WebhookService,
  EVENT_TYPES,
  DLQ_STATUS,
  computeBackoffDelay,
} = require("../services/webhookService");

function createDeadLetterStore() {
  return {
    insert: jest.fn().mockResolvedValue({ id: "dlq-1" }),
    findById: jest.fn().mockResolvedValue(null),
    claimForReplay: jest.fn().mockResolvedValue(null),
    update: jest.fn().mockResolvedValue(undefined),
  };
}

describe("WebhookService", () => {
  let webhookService;
  let deadLetterStore;
  let sleep;

  beforeEach(() => {
    deadLetterStore = createDeadLetterStore();
    sleep = jest.fn().mockResolvedValue(undefined);
    webhookService = new WebhookService({ deadLetterStore, sleep });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------
  // Subscriber management
  // -------------------------------------------------------------------

  describe("register / unregister", () => {
    it("registers a URL for an event type", () => {
      webhookService.register(EVENT_TYPES.MATCH_CREATED, "https://example.com/hook");
      const subs = webhookService.getSubscribers();
      expect(subs[EVENT_TYPES.MATCH_CREATED]).toContain("https://example.com/hook");
    });

    it("throws if eventType or url is missing", () => {
      expect(() => webhookService.register("", "https://x.com")).toThrow("eventType and url are required");
      expect(() => webhookService.register(EVENT_TYPES.MATCH_CREATED, "")).toThrow("eventType and url are required");
    });

    it("removes a registered URL", () => {
      webhookService.register(EVENT_TYPES.MATCH_CREATED, "https://example.com/hook");
      webhookService.unregister(EVENT_TYPES.MATCH_CREATED, "https://example.com/hook");
      const subs = webhookService.getSubscribers();
      expect(subs[EVENT_TYPES.MATCH_CREATED] || []).toHaveLength(0);
    });

    it("does not throw when unregistering a non-existent URL", () => {
      expect(() => webhookService.unregister(EVENT_TYPES.MATCH_CREATED, "https://nope.com")).not.toThrow();
    });
  });

  // -------------------------------------------------------------------
  // HMAC SHA-256 signature
  // -------------------------------------------------------------------

  describe("sign / verify", () => {
    it("produces a valid HMAC SHA-256 signature", () => {
      const payload = '{"event":"match.created"}';
      const sig = webhookService.sign(payload);
      expect(sig).toMatch(/^[a-f0-9]{64}$/);
    });

    it("verifies a valid signature", () => {
      const payload = '{"event":"match.created"}';
      const sig = webhookService.sign(payload);
      expect(webhookService.verify(payload, sig)).toBe(true);
    });

    it("rejects a tampered signature", () => {
      const payload = '{"event":"match.created"}';
      const sig = webhookService.sign(payload);
      expect(webhookService.verify(payload, "0000" + sig.slice(4))).toBe(false);
    });

    it("rejects when WEBHOOK_SECRET is not set", () => {
      const orig = process.env.WEBHOOK_SECRET;
      delete process.env.WEBHOOK_SECRET;
      const svc = new WebhookService();
      expect(() => svc.sign("data")).toThrow("WEBHOOK_SECRET is not configured");
      expect(svc.verify("data", "abc")).toBe(false);
      process.env.WEBHOOK_SECRET = orig;
    });
  });

  // -------------------------------------------------------------------
  // Dispatch
  // -------------------------------------------------------------------

  describe("dispatch", () => {
    it("returns empty array when no subscribers", async () => {
      const results = await webhookService.dispatch(EVENT_TYPES.MATCH_CREATED, { gameCode: "G1" });
      expect(results).toEqual([]);
    });

    it("delivers webhooks to all registered subscribers", async () => {
      const mockFetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
      jest.spyOn(globalThis, "fetch").mockImplementation(mockFetch);

      webhookService.register(EVENT_TYPES.MATCH_CREATED, "https://a.com/hook");
      webhookService.register(EVENT_TYPES.MATCH_CREATED, "https://b.com/hook");

      const results = await webhookService.dispatch(EVENT_TYPES.MATCH_CREATED, { gameCode: "G1" });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.success)).toBe(true);
    });

    it("retries on failure and logs unsuccessful delivery", async () => {
      const mockFetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });
      jest.spyOn(globalThis, "fetch").mockImplementation(mockFetch);

      webhookService.register(EVENT_TYPES.MATCH_CREATED, "https://fail.com/hook");
      const results = await webhookService.dispatch(EVENT_TYPES.MATCH_CREATED, { gameCode: "G1" });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(results[0].attempts).toBe(2);
    });

    it("retries on network error", async () => {
      const mockFetch = jest.fn().mockRejectedValue(new Error("Network error"));
      jest.spyOn(globalThis, "fetch").mockImplementation(mockFetch);

      webhookService.register(EVENT_TYPES.MATCH_CREATED, "https://timeout.com/hook");
      const results = await webhookService.dispatch(EVENT_TYPES.MATCH_CREATED, { gameCode: "G1" });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
    });

    it("attaches X-Webhook-Signature header with HMAC", async () => {
      let capturedHeaders;
      const mockFetch = jest.fn().mockImplementation(async (_url, opts) => {
        capturedHeaders = opts.headers;
        return { ok: true, status: 200 };
      });
      jest.spyOn(globalThis, "fetch").mockImplementation(mockFetch);

      webhookService.register(EVENT_TYPES.MATCH_CREATED, "https://secure.com/hook");
      await webhookService.dispatch(EVENT_TYPES.MATCH_CREATED, { gameCode: "G1" });

      expect(capturedHeaders["X-Webhook-Signature"]).toMatch(/^sha256=[a-f0-9]{64}$/);
      expect(capturedHeaders["X-Webhook-Event"]).toBe(EVENT_TYPES.MATCH_CREATED);
    });

    it("logs successful delivery", async () => {
      const mockFetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
      jest.spyOn(globalThis, "fetch").mockImplementation(mockFetch);

      webhookService.register(EVENT_TYPES.MATCH_CREATED, "https://log.com/hook");
      await webhookService.dispatch(EVENT_TYPES.MATCH_CREATED, { gameCode: "G1" });

      const log = webhookService.getDeliveryLog();
      expect(log).toHaveLength(1);
      expect(log[0].success).toBe(true);
      expect(log[0].url).toBe("https://log.com/hook");
      expect(log[0].event).toBe(EVENT_TYPES.MATCH_CREATED);
    });

    it("clearDeliveryLog resets the log", async () => {
      const mockFetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
      jest.spyOn(globalThis, "fetch").mockImplementation(mockFetch);

      webhookService.register(EVENT_TYPES.MATCH_CREATED, "https://x.com/hook");
      await webhookService.dispatch(EVENT_TYPES.MATCH_CREATED, { gameCode: "G1" });
      webhookService.clearDeliveryLog();
      expect(webhookService.getDeliveryLog()).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------
  // Convenience helpers
  // -------------------------------------------------------------------

  describe("convenience methods", () => {
    it("onMatchCreated dispatches match.created event", async () => {
      const spy = jest.spyOn(webhookService, "dispatch").mockResolvedValue([]);
      const match = { gameCode: "G1", player1: "P1", player2: "P2", wagerAmount: "100" };
      await webhookService.onMatchCreated(match);
      expect(spy).toHaveBeenCalledWith(EVENT_TYPES.MATCH_CREATED, match);
    });

    it("onMatchResolved dispatches match.resolved event", async () => {
      const spy = jest.spyOn(webhookService, "dispatch").mockResolvedValue([]);
      const match = { gameCode: "G1", winner: "P1", resolution: "checkmate", txHash: "abc" };
      await webhookService.onMatchResolved(match);
      expect(spy).toHaveBeenCalledWith(EVENT_TYPES.MATCH_RESOLVED, match);
    });

    it("onPayoutConfirmed dispatches match.payout_confirmed event", async () => {
      const spy = jest.spyOn(webhookService, "dispatch").mockResolvedValue([]);
      const payout = { gameCode: "G1", winner: "P1", amount: "200", txHash: "def", confirmedAt: new Date().toISOString() };
      await webhookService.onPayoutConfirmed(payout);
      expect(spy).toHaveBeenCalledWith(EVENT_TYPES.MATCH_PAYOUT_CONFIRMED, payout);
    });
  });

  // -------------------------------------------------------------------
  // EVENT_TYPES constants
  // -------------------------------------------------------------------

  describe("EVENT_TYPES", () => {
    it("exposes the three expected event types", () => {
      expect(EVENT_TYPES.MATCH_CREATED).toBe("match.created");
      expect(EVENT_TYPES.MATCH_RESOLVED).toBe("match.resolved");
      expect(EVENT_TYPES.MATCH_PAYOUT_CONFIRMED).toBe("match.payout_confirmed");
    });
  });

  // -------------------------------------------------------------------
  // Payload structure
  // -------------------------------------------------------------------

  describe("payload structure", () => {
    it("builds a payload with event, timestamp, and data", () => {
      const payload = webhookService._buildPayload(EVENT_TYPES.MATCH_CREATED, { gameCode: "G1" });
      expect(payload.event).toBe(EVENT_TYPES.MATCH_CREATED);
      expect(payload.timestamp).toBeDefined();
      expect(payload.data.gameCode).toBe("G1");
      expect(new Date(payload.timestamp).toISOString()).toBe(payload.timestamp);
    });
  });

  // -------------------------------------------------------------------
  // Exponential back-off
  // -------------------------------------------------------------------

  describe("computeBackoffDelay", () => {
    const opts = { baseDelayMs: 1000, maxDelayMs: 30000, jitterMs: 500 };

    it("doubles the delay for every failed attempt", () => {
      const noJitter = { ...opts, random: () => 0 };
      expect(computeBackoffDelay(1, noJitter)).toBe(2000);
      expect(computeBackoffDelay(2, noJitter)).toBe(4000);
      expect(computeBackoffDelay(3, noJitter)).toBe(8000);
      expect(computeBackoffDelay(4, noJitter)).toBe(16000);
    });

    it("adds random jitter bounded by jitterMs", () => {
      expect(computeBackoffDelay(1, { ...opts, random: () => 0.5 })).toBe(2250);
      expect(computeBackoffDelay(1, { ...opts, random: () => 0.999 })).toBeLessThan(2500);
    });

    it("caps the delay at maxDelayMs", () => {
      expect(computeBackoffDelay(5, { ...opts, random: () => 0 })).toBe(30000);
      expect(computeBackoffDelay(10, { ...opts, random: () => 0.9 })).toBe(30000);
    });

    it("reads defaults from the environment", () => {
      jest.spyOn(Math, "random").mockReturnValue(0);
      // WEBHOOK_RETRY_DELAY_MS=50 is set at the top of this file
      expect(computeBackoffDelay(1)).toBe(100);
    });
  });

  // -------------------------------------------------------------------
  // Retry policy & dead-letter queue
  // -------------------------------------------------------------------

  describe("retry with dead-letter queue", () => {
    const url = "https://partner.example/hook";
    let originalMaxRetries;

    beforeEach(() => {
      originalMaxRetries = process.env.WEBHOOK_MAX_RETRIES;
      process.env.WEBHOOK_MAX_RETRIES = "5";
      webhookService.register(EVENT_TYPES.MATCH_PAYOUT_CONFIRMED, url);
    });

    afterEach(() => {
      process.env.WEBHOOK_MAX_RETRIES = originalMaxRetries;
    });

    it("retries HTTP 500 five times with growing back-off, then dead-letters", async () => {
      const mockFetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });
      jest.spyOn(globalThis, "fetch").mockImplementation(mockFetch);
      jest.spyOn(Math, "random").mockReturnValue(0);

      const [result] = await webhookService.onPayoutConfirmed({ gameCode: "G1", amount: "200" });

      expect(mockFetch).toHaveBeenCalledTimes(5);
      // Sleeps happen only between attempts: 4 delays for 5 attempts
      expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([100, 200, 400, 800]);

      expect(result).toMatchObject({
        success: false,
        attempts: 5,
        statusCode: 500,
        error: "HTTP 500",
        deadLetterId: "dlq-1",
      });

      expect(deadLetterStore.insert).toHaveBeenCalledTimes(1);
      expect(deadLetterStore.insert).toHaveBeenCalledWith({
        url,
        event_type: EVENT_TYPES.MATCH_PAYOUT_CONFIRMED,
        payload: expect.objectContaining({
          event: EVENT_TYPES.MATCH_PAYOUT_CONFIRMED,
          data: { gameCode: "G1", amount: "200" },
        }),
        attempts: 5,
        last_error: "HTTP 500",
        last_status_code: 500,
        status: DLQ_STATUS.PENDING,
      });
    });

    it("succeeds without dead-lettering when the endpoint recovers", async () => {
      const mockFetch = jest
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 500 })
        .mockResolvedValueOnce({ ok: false, status: 503 })
        .mockResolvedValueOnce({ ok: true, status: 200 });
      jest.spyOn(globalThis, "fetch").mockImplementation(mockFetch);

      const [result] = await webhookService.onPayoutConfirmed({ gameCode: "G1" });

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(sleep).toHaveBeenCalledTimes(2);
      expect(result).toMatchObject({ success: true, attempts: 3, statusCode: 200 });
      expect(deadLetterStore.insert).not.toHaveBeenCalled();
    });

    it("dead-letters network errors after exhausting retries", async () => {
      const mockFetch = jest.fn().mockRejectedValue(new Error("ECONNREFUSED"));
      jest.spyOn(globalThis, "fetch").mockImplementation(mockFetch);

      const [result] = await webhookService.onPayoutConfirmed({ gameCode: "G1" });

      expect(mockFetch).toHaveBeenCalledTimes(5);
      expect(result).toMatchObject({ success: false, statusCode: null, error: "ECONNREFUSED" });
      expect(deadLetterStore.insert).toHaveBeenCalledWith(
        expect.objectContaining({ last_error: "ECONNREFUSED", last_status_code: null, attempts: 5 })
      );
    });

    it("does not retry non-transient 4xx responses", async () => {
      const mockFetch = jest.fn().mockResolvedValue({ ok: false, status: 404 });
      jest.spyOn(globalThis, "fetch").mockImplementation(mockFetch);

      const [result] = await webhookService.onPayoutConfirmed({ gameCode: "G1" });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
      expect(result).toMatchObject({ success: false, attempts: 1, statusCode: 404 });
      expect(deadLetterStore.insert).toHaveBeenCalledWith(
        expect.objectContaining({ attempts: 1, last_status_code: 404 })
      );
    });

    it.each([408, 429])("retries transient HTTP %i responses", async (status) => {
      const mockFetch = jest
        .fn()
        .mockResolvedValueOnce({ ok: false, status })
        .mockResolvedValueOnce({ ok: true, status: 200 });
      jest.spyOn(globalThis, "fetch").mockImplementation(mockFetch);

      const [result] = await webhookService.onPayoutConfirmed({ gameCode: "G1" });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.success).toBe(true);
    });

    it("still resolves when the dead-letter write fails", async () => {
      jest.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 500 });
      deadLetterStore.insert.mockRejectedValue(new Error("db unavailable"));

      const [result] = await webhookService.onPayoutConfirmed({ gameCode: "G1" });

      expect(result).toMatchObject({ success: false, attempts: 5, deadLetterId: null });
      expect(webhookService.getDeliveryLog()).toHaveLength(1);
    });

    it("defaults to five attempts when WEBHOOK_MAX_RETRIES is unset", async () => {
      delete process.env.WEBHOOK_MAX_RETRIES;
      const mockFetch = jest.fn().mockResolvedValue({ ok: false, status: 502 });
      jest.spyOn(globalThis, "fetch").mockImplementation(mockFetch);

      await webhookService.onPayoutConfirmed({ gameCode: "G1" });

      expect(mockFetch).toHaveBeenCalledTimes(5);
    });
  });

  // -------------------------------------------------------------------
  // Manual dead-letter replay
  // -------------------------------------------------------------------

  describe("replayDeadLetterWebhook", () => {
    const deadLetter = {
      id: "dlq-42",
      url: "https://partner.example/hook",
      event_type: EVENT_TYPES.MATCH_PAYOUT_CONFIRMED,
      payload: {
        event: EVENT_TYPES.MATCH_PAYOUT_CONFIRMED,
        timestamp: "2026-01-01T00:00:00.000Z",
        data: { gameCode: "G1" },
      },
      attempts: 5,
      status: DLQ_STATUS.REPLAYING,
      replay_count: 1,
    };

    it("re-delivers the stored payload and marks the entry replayed", async () => {
      deadLetterStore.claimForReplay.mockResolvedValue(deadLetter);
      let sentBody;
      let sentHeaders;
      jest.spyOn(globalThis, "fetch").mockImplementation(async (_url, opts) => {
        sentBody = opts.body;
        sentHeaders = opts.headers;
        return { ok: true, status: 200 };
      });

      const result = await webhookService.replayDeadLetterWebhook("dlq-42");

      expect(deadLetterStore.claimForReplay).toHaveBeenCalledWith("dlq-42");
      expect(JSON.parse(sentBody)).toEqual(deadLetter.payload);
      expect(webhookService.verify(sentBody, sentHeaders["X-Webhook-Signature"].slice(7))).toBe(true);
      expect(result).toMatchObject({ success: true, deadLetterId: "dlq-42" });
      expect(deadLetterStore.update).toHaveBeenCalledWith(
        "dlq-42",
        expect.objectContaining({ status: DLQ_STATUS.REPLAYED, replay_count: 2 })
      );
      expect(deadLetterStore.insert).not.toHaveBeenCalled();
    });

    it("returns the entry to pending with the latest error when replay fails", async () => {
      deadLetterStore.claimForReplay.mockResolvedValue(deadLetter);
      const mockFetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });
      jest.spyOn(globalThis, "fetch").mockImplementation(mockFetch);

      const result = await webhookService.replayDeadLetterWebhook("dlq-42");

      expect(mockFetch).toHaveBeenCalledTimes(2); // WEBHOOK_MAX_RETRIES=2 in this file
      expect(result).toMatchObject({ success: false, deadLetterId: "dlq-42" });
      expect(deadLetterStore.update).toHaveBeenCalledWith(
        "dlq-42",
        expect.objectContaining({
          status: DLQ_STATUS.PENDING,
          replay_count: 2,
          last_error: "HTTP 500",
          last_status_code: 500,
        })
      );
      // A failed replay updates the existing entry instead of creating another
      expect(deadLetterStore.insert).not.toHaveBeenCalled();
    });

    it("releases the claim if delivery throws", async () => {
      deadLetterStore.claimForReplay.mockResolvedValue(deadLetter);
      const orig = process.env.WEBHOOK_SECRET;
      delete process.env.WEBHOOK_SECRET;

      try {
        await expect(webhookService.replayDeadLetterWebhook("dlq-42")).rejects.toThrow(
          "WEBHOOK_SECRET is not configured"
        );
      } finally {
        process.env.WEBHOOK_SECRET = orig;
      }
      expect(deadLetterStore.update).toHaveBeenCalledWith("dlq-42", { status: DLQ_STATUS.PENDING });
    });

    it("throws when the entry does not exist", async () => {
      await expect(webhookService.replayDeadLetterWebhook("missing")).rejects.toThrow(
        "Dead-letter webhook missing not found"
      );
    });

    it("refuses to replay an entry that is not pending", async () => {
      deadLetterStore.findById.mockResolvedValue({ ...deadLetter, status: DLQ_STATUS.REPLAYED });
      const mockFetch = jest.fn();
      jest.spyOn(globalThis, "fetch").mockImplementation(mockFetch);

      await expect(webhookService.replayDeadLetterWebhook("dlq-42")).rejects.toThrow(
        "is not pending (status: replayed)"
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("requires an id", async () => {
      await expect(webhookService.replayDeadLetterWebhook()).rejects.toThrow("id is required");
    });
  });

  // -------------------------------------------------------------------
  // Supabase-backed dead-letter store
  // -------------------------------------------------------------------

  describe("default dead-letter store", () => {
    const supabase = require("../config/supabase");
    let store;
    let query;

    beforeEach(() => {
      store = new WebhookService().deadLetterStore;
      store._supabase = null;
      query = {
        insert: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: { id: "row-1" }, error: null }),
        maybeSingle: jest.fn().mockResolvedValue({ data: { id: "row-1" }, error: null }),
        then: undefined,
      };
      supabase.from.mockReturnValue(query);
    });

    it("uses a service-role client when SUPABASE_SERVICE_ROLE_KEY is set", () => {
      const { createClient } = require("@supabase/supabase-js");
      process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
      try {
        const client = store._client();
        expect(createClient).toHaveBeenCalledWith(process.env.SUPABASE_URL, "service-role-key", {
          auth: { persistSession: false },
        });
        expect(client).not.toBe(supabase);
        expect(store._client()).toBe(client);
      } finally {
        delete process.env.SUPABASE_SERVICE_ROLE_KEY;
        store._supabase = null;
      }
    });

    it("falls back to the shared Supabase client", () => {
      expect(store._client()).toBe(supabase);
    });

    it("inserts into webhook_dead_letter_queue", async () => {
      await expect(store.insert({ url: "u" })).resolves.toEqual({ id: "row-1" });
      expect(supabase.from).toHaveBeenCalledWith("webhook_dead_letter_queue");
      expect(query.insert).toHaveBeenCalledWith({ url: "u" });
    });

    it("claims only pending entries for replay", async () => {
      await store.claimForReplay("row-1");
      expect(query.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: DLQ_STATUS.REPLAYING })
      );
      expect(query.eq).toHaveBeenCalledWith("id", "row-1");
      expect(query.eq).toHaveBeenCalledWith("status", DLQ_STATUS.PENDING);
    });

    it("finds entries by id", async () => {
      await expect(store.findById("row-1")).resolves.toEqual({ id: "row-1" });
      expect(query.eq).toHaveBeenCalledWith("id", "row-1");
    });

    it("updates entries and stamps updated_at", async () => {
      query.eq.mockResolvedValue({ error: null });
      await store.update("row-1", { status: DLQ_STATUS.REPLAYED });
      expect(query.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: DLQ_STATUS.REPLAYED, updated_at: expect.any(String) })
      );
    });

    it("surfaces Supabase errors", async () => {
      query.single.mockResolvedValue({ data: null, error: { message: "permission denied" } });
      await expect(store.insert({})).rejects.toThrow("permission denied");
      query.maybeSingle.mockResolvedValue({ data: null, error: { message: "boom" } });
      await expect(store.findById("x")).rejects.toThrow("boom");
      await expect(store.claimForReplay("x")).rejects.toThrow("boom");
      query.eq.mockResolvedValue({ error: { message: "update failed" } });
      await expect(store.update("x", {})).rejects.toThrow("update failed");
    });
  });
});
