const crypto = require("crypto");
const express = require("express");
const request = require("supertest");

jest.mock("../services/authService", () => ({
  createChallenge: jest.fn(),
  verifySignature: jest.fn(),
  issueToken: jest.fn(),
}));
jest.mock("../models/userModel", () => ({
  findOrCreateByAddress: jest.fn(),
}));
jest.mock("../services/sessionService", () => ({
  isTokenRevoked: jest.fn().mockResolvedValue(false),
  isJtiBlacklisted: jest.fn().mockResolvedValue(false),
}));

const { verifyWebhookSignature } = require("../services/webhookService");
const { webhookAuth, rawBodyCapture } = require("../middleware/webhookAuth");

describe("Webhook SHA-256 HMAC Signature Verification (Issue #581)", () => {
  const secretKey = "test-webhook-secret-key-chesster-388-581";
  const samplePayload = JSON.stringify({
    event: "deposit.confirmed",
    data: {
      account: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFDAGOROTU2W45DEGKOOX",
      amount: "100.5000000",
      asset: "XLM",
      txHash: "a1b2c3d4e5f678901234567890abcdef1234567890abcdef1234567890abcdef",
    },
    timestamp: 1700000000,
  });

  function signPayload(body, secret) {
    const hex = crypto.createHmac("sha256", secret).update(body).digest("hex");
    return `sha256=${hex}`;
  }

  // -------------------------------------------------------------------------
  // 1. Cryptographic Verification Function (verifyWebhookSignature)
  // -------------------------------------------------------------------------
  describe("verifyWebhookSignature cryptographic unit tests", () => {
    it("accepts a valid HMAC-SHA256 signature with sha256= prefix", () => {
      const validSignature = signPayload(samplePayload, secretKey);
      expect(verifyWebhookSignature(samplePayload, validSignature, secretKey)).toBe(true);
    });

    it("accepts a valid HMAC-SHA256 signature when payload is a Buffer", () => {
      const bufferPayload = Buffer.from(samplePayload, "utf8");
      const validSignature = signPayload(bufferPayload, secretKey);
      expect(verifyWebhookSignature(bufferPayload, validSignature, secretKey)).toBe(true);
    });

    it("accepts a valid HMAC-SHA256 signature when bare hex is provided", () => {
      const bareHex = crypto.createHmac("sha256", secretKey).update(samplePayload).digest("hex");
      expect(verifyWebhookSignature(samplePayload, bareHex, secretKey)).toBe(true);
    });

    it("rejects an altered or tampered payload", () => {
      const validSignature = signPayload(samplePayload, secretKey);
      const tamperedPayload = samplePayload.replace("100.5000000", "999.0000000");
      expect(verifyWebhookSignature(tamperedPayload, validSignature, secretKey)).toBe(false);
    });

    it("rejects an altered signature with same length", () => {
      const validSignature = signPayload(samplePayload, secretKey);
      // Flip the last character of the hex digest
      const lastChar = validSignature.slice(-1);
      const flipped = lastChar === "a" ? "b" : "a";
      const tamperedSignature = validSignature.slice(0, -1) + flipped;
      expect(verifyWebhookSignature(samplePayload, tamperedSignature, secretKey)).toBe(false);
    });

    it("rejects signatures generated with a different secret", () => {
      const wrongSecret = "wrong-secret-key-attacker";
      const signatureWithWrongSecret = signPayload(samplePayload, wrongSecret);
      expect(verifyWebhookSignature(samplePayload, signatureWithWrongSecret, secretKey)).toBe(
        false
      );
    });

    it("rejects when signatureHeader is missing, null, undefined, or empty", () => {
      expect(verifyWebhookSignature(samplePayload, "", secretKey)).toBe(false);
      expect(verifyWebhookSignature(samplePayload, null, secretKey)).toBe(false);
      expect(verifyWebhookSignature(samplePayload, undefined, secretKey)).toBe(false);
    });

    it("rejects when secretKey is missing, null, undefined, or empty", () => {
      const validSignature = signPayload(samplePayload, secretKey);
      expect(verifyWebhookSignature(samplePayload, validSignature, "")).toBe(false);
      expect(verifyWebhookSignature(samplePayload, validSignature, null)).toBe(false);
      expect(verifyWebhookSignature(samplePayload, validSignature, undefined)).toBe(false);
    });

    it("rejects when rawBody is not a string or Buffer", () => {
      const validSignature = signPayload(samplePayload, secretKey);
      expect(verifyWebhookSignature(null, validSignature, secretKey)).toBe(false);
      expect(verifyWebhookSignature(undefined, validSignature, secretKey)).toBe(false);
      expect(verifyWebhookSignature(12345, validSignature, secretKey)).toBe(false);
      expect(verifyWebhookSignature({}, validSignature, secretKey)).toBe(false);
    });

    it("uses crypto.timingSafeEqual for constant-time comparison", () => {
      const spyTimingSafe = jest.spyOn(crypto, "timingSafeEqual");
      const validSignature = signPayload(samplePayload, secretKey);

      const result = verifyWebhookSignature(samplePayload, validSignature, secretKey);
      expect(result).toBe(true);
      expect(spyTimingSafe).toHaveBeenCalled();

      spyTimingSafe.mockRestore();
    });

    it("safely handles length mismatch without calling timingSafeEqual to avoid errors", () => {
      const shortSignature = "sha256=12345";
      expect(verifyWebhookSignature(samplePayload, shortSignature, secretKey)).toBe(false);
    });

    it("supports timestamped header format (t=...,v1=...) seamlessly", () => {
      const timestamp = 1700000000;
      const signature = crypto
        .createHmac("sha256", secretKey)
        .update(`${timestamp}.${samplePayload}`)
        .digest("hex");
      const header = `t=${timestamp},v1=${signature}`;
      expect(verifyWebhookSignature(samplePayload, header, secretKey)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Webhook Authentication Middleware (webhookAuth)
  // -------------------------------------------------------------------------
  describe("webhookAuth Express middleware", () => {
    let originalSecret;

    beforeAll(() => {
      originalSecret = process.env.WEBHOOK_SECRET;
      process.env.WEBHOOK_SECRET = secretKey;
    });

    afterAll(() => {
      process.env.WEBHOOK_SECRET = originalSecret;
    });

    it("accepts request with valid HMAC-SHA256 signature in x-chesster-signature header", async () => {
      const app = express();
      app.post("/webhook", rawBodyCapture, webhookAuth, (req, res) => {
        res.status(200).json({ success: true, body: req.body });
      });

      const signature = signPayload(samplePayload, secretKey);

      const res = await request(app)
        .post("/webhook")
        .set("Content-Type", "application/json")
        .set("x-chesster-signature", signature)
        .send(samplePayload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.body.event).toBe("deposit.confirmed");
    });

    it("accepts request with valid signature in x-webhook-signature fallback header", async () => {
      const app = express();
      app.post("/webhook", rawBodyCapture, webhookAuth, (req, res) => {
        res.status(200).json({ success: true, body: req.body });
      });

      const signature = signPayload(samplePayload, secretKey);

      const res = await request(app)
        .post("/webhook")
        .set("Content-Type", "application/json")
        .set("x-webhook-signature", signature)
        .send(samplePayload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("rejects request with missing signature header with HTTP 401 Unauthorized", async () => {
      const app = express();
      app.post("/webhook", rawBodyCapture, webhookAuth, (req, res) => {
        res.status(200).json({ success: true });
      });

      const res = await request(app)
        .post("/webhook")
        .set("Content-Type", "application/json")
        .send(samplePayload);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/Missing webhook signature/i);
    });

    it("rejects request with invalid signature header with HTTP 401 Unauthorized", async () => {
      const app = express();
      app.post("/webhook", rawBodyCapture, webhookAuth, (req, res) => {
        res.status(200).json({ success: true });
      });

      const invalidSig = "sha256=" + "0".repeat(64);

      const res = await request(app)
        .post("/webhook")
        .set("Content-Type", "application/json")
        .set("x-chesster-signature", invalidSig)
        .send(samplePayload);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/Invalid webhook signature/i);
    });

    it("rejects request with altered payload with HTTP 401 Unauthorized", async () => {
      const app = express();
      app.post("/webhook", rawBodyCapture, webhookAuth, (req, res) => {
        res.status(200).json({ success: true });
      });

      const originalSig = signPayload(samplePayload, secretKey);
      const tamperedPayload = samplePayload.replace("deposit.confirmed", "deposit.forged");

      const res = await request(app)
        .post("/webhook")
        .set("Content-Type", "application/json")
        .set("x-chesster-signature", originalSig)
        .send(tamperedPayload);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/Invalid webhook signature/i);
    });

    it("rejects request with HTTP 401 when WEBHOOK_SECRET is unconfigured", async () => {
      const savedSecret = process.env.WEBHOOK_SECRET;
      delete process.env.WEBHOOK_SECRET;

      try {
        const app = express();
        app.post("/webhook", rawBodyCapture, webhookAuth, (req, res) => {
          res.status(200).json({ success: true });
        });

        const sig = signPayload(samplePayload, "some-secret");

        const res = await request(app)
          .post("/webhook")
          .set("Content-Type", "application/json")
          .set("x-chesster-signature", sig)
          .send(samplePayload);

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toMatch(/Webhook secret is not configured/i);
      } finally {
        process.env.WEBHOOK_SECRET = savedSecret;
      }
    });

    it("supports parameterized factory webhookAuth({ secret })", async () => {
      const customSecret = "custom-dedicated-ingress-secret";
      const app = express();
      app.post(
        "/webhook-custom",
        rawBodyCapture,
        webhookAuth({ secret: customSecret }),
        (req, res) => {
          res.status(200).json({ success: true, processed: true });
        }
      );

      const validSig = signPayload(samplePayload, customSecret);
      const invalidSig = signPayload(samplePayload, secretKey); // wrong secret

      const failRes = await request(app)
        .post("/webhook-custom")
        .set("Content-Type", "application/json")
        .set("x-chesster-signature", invalidSig)
        .send(samplePayload);
      expect(failRes.status).toBe(401);

      const passRes = await request(app)
        .post("/webhook-custom")
        .set("Content-Type", "application/json")
        .set("x-chesster-signature", validSig)
        .send(samplePayload);
      expect(passRes.status).toBe(200);
      expect(passRes.body.processed).toBe(true);
    });

    it("automatically captures raw body when preceding body parser is omitted", async () => {
      const app = express();
      app.post("/webhook-auto", webhookAuth, (req, res) => {
        res.status(200).json({ success: true, body: req.body });
      });

      const signature = signPayload(samplePayload, secretKey);

      const res = await request(app)
        .post("/webhook-auto")
        .set("Content-Type", "application/json")
        .set("x-chesster-signature", signature)
        .send(samplePayload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.body.event).toBe("deposit.confirmed");
    });

    it("works with express.json({ verify }) raw body capture (as configured in server.js)", async () => {
      const app = express();
      app.use(
        express.json({
          verify: (req, res, buf) => {
            req.rawBody = buf;
          },
        })
      );
      app.post("/webhook-json", webhookAuth, (req, res) => {
        res.status(200).json({ success: true, body: req.body });
      });

      const signature = signPayload(samplePayload, secretKey);

      const res = await request(app)
        .post("/webhook-json")
        .set("Content-Type", "application/json")
        .set("x-chesster-signature", signature)
        .send(samplePayload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.body.event).toBe("deposit.confirmed");
    });
  });

  // -------------------------------------------------------------------------
  // 3. Integration with Ingress Route (authRoutes.js)
  // -------------------------------------------------------------------------
  describe("Ingress route integration (/api/auth/webhook)", () => {
    let app;
    let savedSecret;

    beforeAll(() => {
      savedSecret = process.env.WEBHOOK_SECRET;
      process.env.WEBHOOK_SECRET = secretKey;

      app = express();
      app.use(
        express.json({
          verify: (req, res, buf) => {
            req.rawBody = buf;
          },
        })
      );
      const authRoutes = require("../routes/authRoutes");
      app.use("/api", authRoutes);
    });

    afterAll(() => {
      process.env.WEBHOOK_SECRET = savedSecret;
    });

    it("POST /api/auth/webhook rejects unauthenticated requests with 401", async () => {
      const res = await request(app)
        .post("/api/auth/webhook")
        .set("Content-Type", "application/json")
        .send(samplePayload);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it("POST /api/auth/webhook rejects forged signatures with 401", async () => {
      const forgedSig = "sha256=" + "f".repeat(64);

      const res = await request(app)
        .post("/api/auth/webhook")
        .set("Content-Type", "application/json")
        .set("x-chesster-signature", forgedSig)
        .send(samplePayload);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it("POST /api/auth/webhook accepts authentic webhook notification with 200", async () => {
      const validSig = signPayload(samplePayload, secretKey);

      const res = await request(app)
        .post("/api/auth/webhook")
        .set("Content-Type", "application/json")
        .set("x-chesster-signature", validSig)
        .send(samplePayload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe("Webhook accepted");
      expect(res.body.data.event).toBe("deposit.confirmed");
    });
  });
});
