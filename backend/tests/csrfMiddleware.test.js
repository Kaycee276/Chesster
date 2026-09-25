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
});
