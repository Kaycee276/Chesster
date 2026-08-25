process.env.WEBHOOK_SECRET = "test-webhook-secret-key";
process.env.WEBHOOK_TIMEOUT_MS = "1000";
process.env.WEBHOOK_MAX_RETRIES = "2";
process.env.WEBHOOK_RETRY_DELAY_MS = "50";

const { WebhookService, EVENT_TYPES } = require("../services/webhookService");

describe("WebhookService", () => {
  let webhookService;

  beforeEach(() => {
    webhookService = new WebhookService();
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
});
