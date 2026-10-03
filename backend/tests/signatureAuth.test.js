const request = require("supertest");
const express = require("express");
const { Keypair } = require("stellar-sdk");
const { verifyRequestSignature, verifyStellarSignature } = require("../middlewares/signatureAuth");

describe("Signature Authentication Middleware (Issue #323)", () => {
  let app;
  let keypair;

  beforeEach(() => {
    keypair = Keypair.random();
    app = express();
    app.use(express.json());

    app.post(
      "/api/escrow/relay",
      verifyRequestSignature({ maxWindowMs: 300000 }),
      (req, res) => {
        res.status(200).json({
          success: true,
          authenticatedPublicKey: req.authenticatedPublicKey,
          body: req.body,
        });
      }
    );
  });

  function generateSignatureHeaders(kp, method, path, body, timestamp = Date.now()) {
    const bodyStr = typeof body === "object" ? JSON.stringify(body) : body || "";
    const message = `${method.toUpperCase()}:${path}:${timestamp}:${bodyStr}`;
    const signature = kp.sign(Buffer.from(message)).toString("base64");

    return {
      "x-signature": signature,
      "x-timestamp": timestamp.toString(),
      "x-public-key": kp.publicKey(),
    };
  }

  test("allows valid signed requests within the 5-minute replay window", async () => {
    const payload = { gameCode: "chess-123", action: "join" };
    const headers = generateSignatureHeaders(keypair, "POST", "/api/escrow/relay", payload);

    const res = await request(app)
      .post("/api/escrow/relay")
      .set(headers)
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.authenticatedPublicKey).toBe(keypair.publicKey());
  });

  test("rejects requests missing signature headers with 401", async () => {
    const res = await request(app)
      .post("/api/escrow/relay")
      .send({ gameCode: "chess-123" });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Missing required signature authentication headers/i);
  });

  test("rejects requests with expired timestamps (>5 minutes) with 401", async () => {
    const expiredTimestamp = Date.now() - (6 * 60 * 1000); // 6 mins ago
    const payload = { gameCode: "chess-123" };
    const headers = generateSignatureHeaders(keypair, "POST", "/api/escrow/relay", payload, expiredTimestamp);

    const res = await request(app)
      .post("/api/escrow/relay")
      .set(headers)
      .send(payload);

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/outside the allowed replay window/i);
  });

  test("rejects requests with forged/tampered payloads with 401", async () => {
    const payload = { gameCode: "chess-123", action: "join" };
    const headers = generateSignatureHeaders(keypair, "POST", "/api/escrow/relay", payload);

    // Tamper with payload
    const tamperedPayload = { gameCode: "chess-123", action: "steal_funds" };

    const res = await request(app)
      .post("/api/escrow/relay")
      .set(headers)
      .send(tamperedPayload);

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Invalid request signature/i);
  });

  test("rejects requests with forged signature from another keypair with 401", async () => {
    const evilKeypair = Keypair.random();
    const payload = { gameCode: "chess-123" };
    const headers = generateSignatureHeaders(evilKeypair, "POST", "/api/escrow/relay", payload);
    // Replace public key header with victim's public key
    headers["x-public-key"] = keypair.publicKey();

    const res = await request(app)
      .post("/api/escrow/relay")
      .set(headers)
      .send(payload);

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Invalid request signature/i);
  });

  test("verifyStellarSignature helper functions properly", () => {
    const msg = "test-message";
    const sig = keypair.sign(Buffer.from(msg)).toString("base64");
    expect(verifyStellarSignature(keypair.publicKey(), msg, sig)).toBe(true);
    expect(verifyStellarSignature(keypair.publicKey(), "altered", sig)).toBe(false);
  });
});
