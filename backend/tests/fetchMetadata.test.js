const express = require("express");
const request = require("supertest");
const {
  fetchMetadataPolicy,
  createFetchMetadataMiddleware,
  isPathExempt,
  DEFAULT_EXEMPT_PATHS,
} = require("../middleware/fetchMetadata");

describe("Fetch Metadata & Origin Defense Middleware", () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(fetchMetadataPolicy);

    app.get("/api/test-safe", (req, res) => {
      res.json({ message: "safe get success" });
    });

    app.head("/api/test-safe", (req, res) => {
      res.status(200).end();
    });

    app.options("/api/test-safe", (req, res) => {
      res.status(204).end();
    });

    app.post("/api/test-mutate", (req, res) => {
      res.json({ message: "mutate post success" });
    });

    app.put("/api/test-mutate", (req, res) => {
      res.json({ message: "mutate put success" });
    });

    app.patch("/api/test-mutate", (req, res) => {
      res.json({ message: "mutate patch success" });
    });

    app.delete("/api/test-mutate", (req, res) => {
      res.json({ message: "mutate delete success" });
    });

    // Public exempt routes
    app.post("/health/readiness", (req, res) => {
      res.json({ status: "healthy" });
    });

    app.post("/api/webhooks/payment", (req, res) => {
      res.json({ received: true });
    });
  });

  describe("Safe HTTP methods (GET, HEAD, OPTIONS)", () => {
    test("should allow GET request with cross-site Sec-Fetch-Site", async () => {
      const res = await request(app)
        .get("/api/test-safe")
        .set("Sec-Fetch-Site", "cross-site");

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("safe get success");
    });

    test("should allow HEAD request with cross-site Sec-Fetch-Site", async () => {
      const res = await request(app)
        .head("/api/test-safe")
        .set("Sec-Fetch-Site", "cross-site");

      expect(res.status).toBe(200);
    });

    test("should allow OPTIONS request with cross-site Sec-Fetch-Site", async () => {
      const res = await request(app)
        .options("/api/test-safe")
        .set("Sec-Fetch-Site", "cross-site");

      expect(res.status).toBe(204);
    });

    test("should allow GET request when Sec-Fetch-Site is not provided", async () => {
      const res = await request(app).get("/api/test-safe");

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("safe get success");
    });
  });

  describe("Mutating HTTP methods (POST, PUT, PATCH, DELETE)", () => {
    test("should allow mutating POST request with Sec-Fetch-Site: same-origin", async () => {
      const res = await request(app)
        .post("/api/test-mutate")
        .set("Sec-Fetch-Site", "same-origin")
        .send({ key: "val" });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("mutate post success");
    });

    test("should allow mutating POST request with Sec-Fetch-Site: same-site", async () => {
      const res = await request(app)
        .post("/api/test-mutate")
        .set("Sec-Fetch-Site", "same-site")
        .send({ key: "val" });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("mutate post success");
    });

    test("should allow mutating POST request with Sec-Fetch-Site: none (user navigation/direct)", async () => {
      const res = await request(app)
        .post("/api/test-mutate")
        .set("Sec-Fetch-Site", "none")
        .send({ key: "val" });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("mutate post success");
    });

    test("should allow mutating POST request when Sec-Fetch-Site header is missing (e.g. non-browser client)", async () => {
      const res = await request(app)
        .post("/api/test-mutate")
        .send({ key: "val" });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("mutate post success");
    });

    test("should reject mutating POST request with Sec-Fetch-Site: cross-site with 403", async () => {
      const res = await request(app)
        .post("/api/test-mutate")
        .set("Sec-Fetch-Site", "cross-site")
        .send({ key: "val" });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({
        error: "Forbidden: Cross-site request rejected by fetch metadata policy",
      });
    });

    test("should reject mutating PUT request with Sec-Fetch-Site: cross-site with 403", async () => {
      const res = await request(app)
        .put("/api/test-mutate")
        .set("Sec-Fetch-Site", "cross-site")
        .send({ key: "val" });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe(
        "Forbidden: Cross-site request rejected by fetch metadata policy"
      );
    });

    test("should reject mutating PATCH request with Sec-Fetch-Site: cross-site with 403", async () => {
      const res = await request(app)
        .patch("/api/test-mutate")
        .set("Sec-Fetch-Site", "cross-site")
        .send({ key: "val" });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe(
        "Forbidden: Cross-site request rejected by fetch metadata policy"
      );
    });

    test("should reject mutating DELETE request with Sec-Fetch-Site: cross-site with 403", async () => {
      const res = await request(app)
        .delete("/api/test-mutate")
        .set("Sec-Fetch-Site", "cross-site");

      expect(res.status).toBe(403);
      expect(res.body.error).toBe(
        "Forbidden: Cross-site request rejected by fetch metadata policy"
      );
    });

    test("should reject mutating request with unexpected Sec-Fetch-Site header with 403", async () => {
      const res = await request(app)
        .post("/api/test-mutate")
        .set("Sec-Fetch-Site", "invalid-untrusted-site")
        .send({ key: "val" });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe(
        "Forbidden: Cross-site request rejected by fetch metadata policy"
      );
    });
  });

  describe("Exempt Route Allowlist", () => {
    test("should allow cross-site mutating requests on exempt health routes", async () => {
      const res = await request(app)
        .post("/health/readiness")
        .set("Sec-Fetch-Site", "cross-site")
        .send({ ping: true });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("healthy");
    });

    test("should allow cross-site mutating requests on exempt webhook routes", async () => {
      const res = await request(app)
        .post("/api/webhooks/payment")
        .set("Sec-Fetch-Site", "cross-site")
        .send({ event: "charge.succeeded" });

      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
    });

    test("isPathExempt helper accurately checks paths against allowlist", () => {
      expect(isPathExempt("/health")).toBe(true);
      expect(isPathExempt("/health/liveness")).toBe(true);
      expect(isPathExempt("/api/health")).toBe(true);
      expect(isPathExempt("/api/webhooks/events")).toBe(true);
      expect(isPathExempt("/api/games/create")).toBe(false);
      expect(isPathExempt(null)).toBe(false);
    });
  });

  describe("Custom Configuration & Allowed Origins", () => {
    test("should allow cross-site mutating request when origin is in allowedOrigins", async () => {
      const customApp = express();
      customApp.use(express.json());
      customApp.use(
        createFetchMetadataMiddleware({
          allowedOrigins: ["https://trusted-partner.com"],
        })
      );
      customApp.post("/api/custom", (req, res) => res.json({ success: true }));

      const res = await request(customApp)
        .post("/api/custom")
        .set("Sec-Fetch-Site", "cross-site")
        .set("Origin", "https://trusted-partner.com")
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test("should reject cross-site mutating request when origin is not in allowedOrigins", async () => {
      const customApp = express();
      customApp.use(express.json());
      customApp.use(
        createFetchMetadataMiddleware({
          allowedOrigins: ["https://trusted-partner.com"],
        })
      );
      customApp.post("/api/custom", (req, res) => res.json({ success: true }));

      const res = await request(customApp)
        .post("/api/custom")
        .set("Sec-Fetch-Site", "cross-site")
        .set("Origin", "https://malicious-attacker.com")
        .send({});

      expect(res.status).toBe(403);
      expect(res.body.error).toBe(
        "Forbidden: Cross-site request rejected by fetch metadata policy"
      );
    });

    test("should respect custom isExempt callback", async () => {
      const customApp = express();
      customApp.use(express.json());
      customApp.use(
        createFetchMetadataMiddleware({
          isExempt: (req) => req.headers["x-custom-bypass"] === "secret",
        })
      );
      customApp.post("/api/custom", (req, res) => res.json({ success: true }));

      const res = await request(customApp)
        .post("/api/custom")
        .set("Sec-Fetch-Site", "cross-site")
        .set("x-custom-bypass", "secret")
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
