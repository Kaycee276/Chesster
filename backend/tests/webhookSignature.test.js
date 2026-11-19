process.env.SUPABASE_URL = "http://localhost";
process.env.SUPABASE_ANON_KEY = "test-key";

const crypto = require("crypto");
const express = require("express");
const request = require("supertest");

const { verifyIngressSignature } = require("../services/webhookService");
const webhookRoutes = require("../routes/webhookRoutes");

const SECRET = "test-webhook-secret";

function sign(body, secret = SECRET) {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

describe("verifyIngressSignature (Issue #581)", () => {
  const body = JSON.stringify({ event: "deposit.confirmed", amount: "100" });

  test("accepts a valid signature over a string or Buffer body", () => {
    expect(verifyIngressSignature(body, sign(body), SECRET)).toBe(true);
    expect(verifyIngressSignature(Buffer.from(body), sign(body), SECRET)).toBe(true);
  });

  test("rejects an altered payload", () => {
    expect(verifyIngressSignature(body.replace("100", "999"), sign(body), SECRET)).toBe(false);
  });

  test("rejects a signature made with a different secret", () => {
    expect(verifyIngressSignature(body, sign(body, "other-secret"), SECRET)).toBe(false);
  });

  test("rejects missing or empty header and secret", () => {
    expect(verifyIngressSignature(body, undefined, SECRET)).toBe(false);
    expect(verifyIngressSignature(body, "", SECRET)).toBe(false);
    expect(verifyIngressSignature(body, sign(body), undefined)).toBe(false);
    expect(verifyIngressSignature(body, sign(body), "")).toBe(false);
  });

  test("rejects a header without the sha256= prefix", () => {
    const bare = sign(body).slice("sha256=".length);
    expect(verifyIngressSignature(body, bare, SECRET)).toBe(false);
  });

  test("rejects wrong-length and non-string inputs without throwing", () => {
    expect(verifyIngressSignature(body, "sha256=abc", SECRET)).toBe(false);
    expect(verifyIngressSignature(body, `${sign(body)}00`, SECRET)).toBe(false);
    expect(verifyIngressSignature(body, ["x"], SECRET)).toBe(false);
    expect(verifyIngressSignature(null, sign(body), SECRET)).toBe(false);
    expect(verifyIngressSignature({}, sign(body), SECRET)).toBe(false);
  });

  test("uses crypto.timingSafeEqual for the comparison", () => {
    const spy = jest.spyOn(crypto, "timingSafeEqual");
    verifyIngressSignature(body, sign(body), SECRET);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe("POST /api/webhooks/ingress (Issue #581)", () => {
  const originalPrimary = process.env.WEBHOOK_SECRET_PRIMARY;
  const originalFallback = process.env.WEBHOOK_SECRET;
  const originalSecondary = process.env.WEBHOOK_SECRET_SECONDARY;
  let app;
  const payload = JSON.stringify({ event: "deposit.confirmed", gameCode: "ABC123" });

  beforeEach(() => {
    process.env.WEBHOOK_SECRET_PRIMARY = SECRET;
    delete process.env.WEBHOOK_SECRET_SECONDARY;
    app = express();
    app.use("/api/webhooks", webhookRoutes);
  });

  afterAll(() => {
    if (originalPrimary === undefined) delete process.env.WEBHOOK_SECRET_PRIMARY;
    else process.env.WEBHOOK_SECRET_PRIMARY = originalPrimary;

    if (originalSecondary === undefined) delete process.env.WEBHOOK_SECRET_SECONDARY;
    else process.env.WEBHOOK_SECRET_SECONDARY = originalSecondary;

    if (originalFallback === undefined) delete process.env.WEBHOOK_SECRET;
    else process.env.WEBHOOK_SECRET = originalFallback;
  });

  const post = (body, headers = {}) =>
    request(app)
      .post("/api/webhooks/ingress")
      .set("Content-Type", "application/json")
      .set(headers)
      .send(body);

  test("accepts a correctly signed request", async () => {
    const res = await post(payload, { "x-chesster-signature": sign(payload) });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ success: true, received: true });
  });

  test("rejects an altered payload with 401", async () => {
    const res = await post(payload.replace("ABC123", "XYZ999"), {
      "x-chesster-signature": sign(payload),
    });
    expect(res.status).toBe(401);
  });

  test("rejects a missing signature header with 401", async () => {
    const res = await post(payload);
    expect(res.status).toBe(401);
  });

  test("rejects an invalid signature with 401", async () => {
    const res = await post(payload, { "x-chesster-signature": "sha256=" + "0".repeat(64) });
    expect(res.status).toBe(401);
  });

  test("rejects every request with 401 when WEBHOOK_SECRET is unset", async () => {
    delete process.env.WEBHOOK_SECRET;
    const res = await post(payload, { "x-chesster-signature": sign(payload) });
    expect(res.status).toBe(401);
  });

  test("rejects a non-JSON content type with 401 even if signed", async () => {
    const res = await request(app)
      .post("/api/webhooks/ingress")
      .set("Content-Type", "text/plain")
      .set("x-chesster-signature", sign(payload))
      .send(payload);
    expect(res.status).toBe(401);
  });

  test("returns identical bodies for every kind of 401", async () => {
    const missing = await post(payload);
    const bad = await post(payload, { "x-chesster-signature": "sha256=nope" });
    expect(missing.body).toEqual(bad.body);
  });

  test("returns 400 for a correctly signed but malformed JSON body", async () => {
    const bad = "{not json";
    const res = await post(bad, { "x-chesster-signature": sign(bad) });
    expect(res.status).toBe(400);
  });

  describe("dual-secret rotation (Issue #702)", () => {
    test("accepts webhook signed with primary secret when secondary is not configured", async () => {
      process.env.WEBHOOK_SECRET_PRIMARY = SECRET;
      delete process.env.WEBHOOK_SECRET_SECONDARY;
      const res = await post(payload, { "x-chesster-signature": sign(payload, SECRET) });
      expect(res.status).toBe(202);
    });

    test("accepts webhook signed with primary secret when secondary is configured", async () => {
      const secondarySecret = "secondary-webhook-secret";
      process.env.WEBHOOK_SECRET_PRIMARY = SECRET;
      process.env.WEBHOOK_SECRET_SECONDARY = secondarySecret;
      const res = await post(payload, { "x-chesster-signature": sign(payload, SECRET) });
      expect(res.status).toBe(202);
    });

    test("accepts webhook signed with secondary secret", async () => {
      const secondarySecret = "secondary-webhook-secret";
      process.env.WEBHOOK_SECRET_PRIMARY = SECRET;
      process.env.WEBHOOK_SECRET_SECONDARY = secondarySecret;
      const res = await post(payload, { "x-chesster-signature": sign(payload, secondarySecret) });
      expect(res.status).toBe(202);
    });

    test("rejects webhook signed with neither primary nor secondary secret", async () => {
      const wrongSecret = "wrong-webhook-secret";
      process.env.WEBHOOK_SECRET_PRIMARY = SECRET;
      process.env.WEBHOOK_SECRET_SECONDARY = "secondary-webhook-secret";
      const res = await post(payload, { "x-chesster-signature": sign(payload, wrongSecret) });
      expect(res.status).toBe(401);
    });

    test("falls back to WEBHOOK_SECRET for backward compatibility", async () => {
      delete process.env.WEBHOOK_SECRET_PRIMARY;
      process.env.WEBHOOK_SECRET = SECRET;
      delete process.env.WEBHOOK_SECRET_SECONDARY;
      const res = await post(payload, { "x-chesster-signature": sign(payload, SECRET) });
      expect(res.status).toBe(202);
    });
  });

  test("exposes the parsed payload and raw body to downstream handlers", async () => {
    const { webhookAuth } = require("../middleware/webhookAuth");
    const seen = {};
    const a = express();
    a.post("/hook", webhookAuth, (req, res) => {
      seen.body = req.body;
      seen.raw = req.rawBody.toString("utf8");
      res.sendStatus(200);
    });
    await request(a)
      .post("/hook")
      .set("Content-Type", "application/json")
      .set("x-chesster-signature", sign(payload))
      .send(payload)
      .expect(200);
    expect(seen.body).toEqual(JSON.parse(payload));
    expect(seen.raw).toBe(payload);
  });
});
