jest.mock("../services/dbHealthService", () => ({
  checkDbHealth: jest.fn(),
  getPoolMetrics: jest.fn(),
}));

jest.mock("@stellar/stellar-sdk", () => ({
  Networks: { TESTNET: "Test SDF Network ; September 2015" },
  rpc: { Server: jest.fn() },
}), { virtual: true });

const express = require("express");
const request = require("supertest");
const healthRoutes = require("../routes/healthRoutes");
const { checkDbHealth, getPoolMetrics } = require("../services/dbHealthService");

describe("GET /api/health/db", () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use("/api", healthRoutes);
    jest.clearAllMocks();
  });

  it("returns 200 for a healthy database", async () => {
    checkDbHealth.mockResolvedValue({
      status: "healthy",
      latencyMs: 12.34,
      pool: { active: null, idle: null },
    });

    const response = await request(app).get("/api/health/db");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "healthy",
      latencyMs: 12.34,
      pool: { active: null, idle: null },
    });
  });

  it("returns 503 when the database is unhealthy", async () => {
    checkDbHealth.mockResolvedValue({
      status: "unhealthy",
      latencyMs: 2001,
      error: "Database health check timed out after 2000ms",
    });

    const response = await request(app).get("/api/health/db");

    expect(response.status).toBe(503);
    expect(response.body.status).toBe("unhealthy");
    expect(response.body.error).toContain("timed out");
  });
});

describe("GET /api/health/db/pool", () => {
	it("returns the current pool counters", async () => {
		const app = express();
		app.use("/api", healthRoutes);
		getPoolMetrics.mockReturnValue({ total: 4, idle: 1, waiting: 2, timestamp: "2026-10-16T00:00:00.000Z" });

		const response = await request(app).get("/api/health/db/pool");

		expect(response.status).toBe(200);
		expect(response.body).toEqual({ total: 4, idle: 1, waiting: 2, timestamp: "2026-10-16T00:00:00.000Z" });
		expect(getPoolMetrics).toHaveBeenCalledTimes(1);
	});
});
