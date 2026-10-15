const request = require("supertest");
const express = require("express");
const { Keypair } = require("stellar-sdk");
const {
  verifyRequestSignature,
  verifyCoordinatorSignature,
  verifyStellarSignature,
} = require("../middlewares/signatureAuth");

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

describe("Coordinator Signature Freshness & Nonce Replay Expiry (Issue #445)", () => {
  let app;
  let coordinatorKeypair;
  let mockRedis;

  beforeEach(() => {
    coordinatorKeypair = Keypair.random();
    const store = new Map();
    mockRedis = {
      set: jest.fn(async (key, val, ex, ttl, nx) => {
        if (nx && store.has(key)) {
          return null;
        }
        store.set(key, val);
        return "OK";
      }),
      get: jest.fn(async (key) => store.get(key) || null),
    };

    app = express();
    app.use(express.json());

    app.post(
      "/api/coordinator/settlement",
      verifyCoordinatorSignature({
        coordinatorPublicKey: coordinatorKeypair.publicKey(),
        redisClient: mockRedis,
        maxWindowMs: 60000,
        nonceTtlSeconds: 300,
      }),
      (req, res) => {
        res.status(200).json({
          success: true,
          authenticatedCoordinator: req.authenticatedCoordinator,
          body: req.body,
        });
      }
    );
  });

  function signCoordinatorPayload(kp, body, timestamp = Date.now(), nonce = "nonce-" + Math.random()) {
    const bodyStr = typeof body === "object" && body !== null ? JSON.stringify(body) : body || "";
    const message = `${timestamp}.${nonce}.${bodyStr}`;
    const signature = kp.sign(Buffer.from(message)).toString("base64");

    return {
      headers: {
        "x-chesster-signature": signature,
        "x-chesster-timestamp": timestamp.toString(),
        "x-chesster-nonce": nonce,
        "x-chesster-public-key": kp.publicKey(),
      },
      nonce,
      timestamp,
      signature,
    };
  }

  test("allows valid signed coordinator settlement within 60s window", async () => {
    const payload = { gameCode: "GAME99", winner: "GDRAW" };
    const { headers } = signCoordinatorPayload(coordinatorKeypair, payload);

    const res = await request(app)
      .post("/api/coordinator/settlement")
      .set(headers)
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.authenticatedCoordinator).toBe(coordinatorKeypair.publicKey());
    expect(mockRedis.set).toHaveBeenCalledWith(
      `coordinator:nonce:${headers["x-chesster-nonce"]}`,
      "1",
      "EX",
      300,
      "NX"
    );
  });

  test("rejects requests missing required security headers with 401", async () => {
    const res = await request(app)
      .post("/api/coordinator/settlement")
      .send({ gameCode: "GAME99" });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Missing security headers/i);
  });

  test("rejects stale requests older than 60 seconds with 401", async () => {
    const staleTime = Date.now() - 65000; // 65 seconds ago
    const payload = { gameCode: "GAME99", winner: "GDRAW" };
    const { headers } = signCoordinatorPayload(coordinatorKeypair, payload, staleTime);

    const res = await request(app)
      .post("/api/coordinator/settlement")
      .set(headers)
      .send(payload);

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Request signature expired/i);
  });

  test("rejects requests with timestamps skewed too far in future (>60s) with 401", async () => {
    const futureTime = Date.now() + 65000; // 65s in future
    const payload = { gameCode: "GAME99" };
    const { headers } = signCoordinatorPayload(coordinatorKeypair, payload, futureTime);

    const res = await request(app)
      .post("/api/coordinator/settlement")
      .set(headers)
      .send(payload);

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Request signature expired/i);
  });

  test("rejects replay attacks with duplicate nonce with 409", async () => {
    const payload = { gameCode: "GAME99", winner: "GDRAW" };
    const { headers } = signCoordinatorPayload(coordinatorKeypair, payload);

    // First request succeeds
    const res1 = await request(app)
      .post("/api/coordinator/settlement")
      .set(headers)
      .send(payload);
    expect(res1.status).toBe(200);

    // Second request with identical nonce is rejected with 409
    const res2 = await request(app)
      .post("/api/coordinator/settlement")
      .set(headers)
      .send(payload);

    expect(res2.status).toBe(409);
    expect(res2.body.error).toMatch(/Replay detected: nonce already processed/i);
  });

  test("rejects requests with invalid cryptographic signature with 403", async () => {
    const attackerKeypair = Keypair.random();
    const payload = { gameCode: "GAME99", winner: "GEVIL" };
    const { headers } = signCoordinatorPayload(attackerKeypair, payload);
    // Masquerade as coordinator public key
    headers["x-chesster-public-key"] = coordinatorKeypair.publicKey();

    const res = await request(app)
      .post("/api/coordinator/settlement")
      .set(headers)
      .send(payload);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Invalid cryptographic signature/i);
  });

  test("rejects requests where payload was tampered after signing with 403", async () => {
    const payload = { gameCode: "GAME99", winner: "GDRAW" };
    const { headers } = signCoordinatorPayload(coordinatorKeypair, payload);

    const res = await request(app)
      .post("/api/coordinator/settlement")
      .set(headers)
      .send({ gameCode: "GAME99", winner: "GTAMPERED" });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Invalid cryptographic signature/i);
  });
});
