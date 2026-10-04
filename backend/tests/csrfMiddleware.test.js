const request = require("supertest");
const express = require("express");
const { csrfProtection } = require("../middleware/csrfMiddleware");

function buildApp() {
  const app = express();
  app.use(csrfProtection);
  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.post("/mutation", (_req, res) => res.json({ ok: true }));
  return app;
}

describe("CSRF protection", () => {
  it("sets a token cookie on safe requests", async () => {
    const response = await request(buildApp()).get("/health");
    expect(response.status).toBe(200);
    expect(response.headers["set-cookie"][0]).toMatch(/XSRF-TOKEN=/);
  });

  it("rejects mutations without a matching header", async () => {
    const response = await request(buildApp()).post("/mutation");
    expect(response.status).toBe(403);
  });

  it("allows mutations with the double-submit token", async () => {
    const agent = request.agent(buildApp());
    const tokenResponse = await agent.get("/health");
    const cookie = tokenResponse.headers["set-cookie"][0].split(";")[0];
    const token = cookie.split("=")[1];
    const response = await agent.post("/mutation").set("X-XSRF-TOKEN", token);
    expect(response.status).toBe(200);
  });

  it("allows mutations with a valid signed token even without cookies (cross-origin SPA)", async () => {
    const { generateSignedToken } = require("../middleware/csrfMiddleware");
    const validToken = generateSignedToken();

    // Direct request without cookie (simulating cross-origin browser blocking third-party cookies)
    const response = await request(buildApp())
      .post("/mutation")
      .set("X-XSRF-TOKEN", validToken);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it("rejects mutations with an invalid signed token without matching cookie", async () => {
    const invalidToken = "invalid.token.signature";
    const response = await request(buildApp())
      .post("/mutation")
      .set("X-XSRF-TOKEN", invalidToken);

    expect(response.status).toBe(403);
    expect(response.body.error).toMatch(/CSRF token validation failed/);
  });

  it("rejects mutations with an expired signed token", async () => {
    const crypto = require("crypto");
    const CSRF_SECRET = process.env.CSRF_SECRET || process.env.JWT_SECRET || "chesster-csrf-secret-key-fallback";
    // Timestamp from 2 days ago
    const pastTimestamp = (Date.now() - 2 * 24 * 60 * 60 * 1000).toString(36);
    const random = crypto.randomBytes(16).toString("hex");
    const payload = `${pastTimestamp}.${random}`;
    const hmac = crypto.createHmac("sha256", CSRF_SECRET).update(payload).digest("hex");
    const expiredToken = `${payload}.${hmac}`;

    const response = await request(buildApp())
      .post("/mutation")
      .set("X-XSRF-TOKEN", expiredToken);

    expect(response.status).toBe(403);
    expect(response.body.error).toMatch(/CSRF token validation failed/);
  });
});
