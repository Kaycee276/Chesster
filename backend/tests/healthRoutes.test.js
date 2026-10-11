/**
 * Tests for Health Check and Service Status Monitoring
 */

const request = require("supertest");
const express = require("express");

jest.mock("@stellar/stellar-sdk", () => ({
  Networks: { TESTNET: "Test SDF Network ; September 2015" },
  rpc: { Server: jest.fn(() => ({ getLatestLedger: jest.fn().mockResolvedValue({ sequence: 1 }) })) },
}));

jest.mock("../config/supabase", () => ({
  from: jest.fn(() => ({
    select: jest.fn(() => ({
      limit: jest.fn().mockResolvedValue({ data: [{ count: 1, id: "test" }], error: null }),
    })),
  })),
}));

const healthRoutes = require("../routes/healthRoutes");
const { clearDbHealthCache } = require("../services/dbHealthService");

describe("Health Check Routes", () => {
  let app;

  beforeEach(() => {
    process.env.SUPABASE_URL = "http://localhost";
    process.env.SUPABASE_ANON_KEY = "test-anon-key";
    process.env.SUPABASE_KEY = "test-service-key";
    process.env.SOROBAN_RPC_URL = "http://localhost";
    clearDbHealthCache();
    app = express();
    app.use(express.json());
    app.use("/api", healthRoutes);
    app.use("/", healthRoutes);
  });

  describe("GET /health/liveness", () => {
    test("should return 200 with process metrics without external calls", async () => {
      const response = await request(app).get("/health/liveness");
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("status", "ok");
      expect(response.body).toHaveProperty("uptimeSeconds");
      expect(response.body).toHaveProperty("timestamp");
      expect(response.body).toHaveProperty("memory");
      expect(response.body.memory).toHaveProperty("heapUsedMb");
    });
  });

  describe("GET /health/readiness", () => {
    test("should return 200 when database dependencies are healthy", async () => {
      const response = await request(app).get("/health/readiness");
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("status", "ready");
      expect(response.body).toHaveProperty("components");
      expect(response.body.components.database.status).toBe("healthy");
    });

    test("should utilize TTL cache on subsequent probe within 3 seconds", async () => {
      const firstRes = await request(app).get("/health/readiness");
      expect(firstRes.status).toBe(200);
      const secondRes = await request(app).get("/health/readiness");
      expect(secondRes.status).toBe(200);
      expect(secondRes.body.components.database.cached).toBe(true);
    });
  });

  describe("GET /api/health", () => {
    test("should return 200 status", async () => {
      const response = await request(app).get("/api/health");
      expect(response.status).toBe(200);
    });

    test("should return basic health status", async () => {
      const response = await request(app).get("/api/health");
      expect(response.body).toHaveProperty("status", "ok");
      expect(response.body).toHaveProperty("message");
      expect(response.body).toHaveProperty("timestamp");
      expect(response.body).toHaveProperty("uptime");
    });

    test("should include environment info", async () => {
      const response = await request(app).get("/api/health");
      expect(response.body).toHaveProperty("environment");
    });
  });

  describe("GET /api/status", () => {
    test("should return status object", async () => {
      const response = await request(app).get("/api/status");
      expect(response.body).toHaveProperty("status");
      expect(response.body).toHaveProperty("timestamp");
      expect(response.body).toHaveProperty("services");
    });

    test("should check database service", async () => {
      const response = await request(app).get("/api/status");
      expect(response.body.services).toHaveProperty("database");
      expect(response.body.services.database).toHaveProperty("status");
    });

    test("should check Stellar RPC service", async () => {
      const response = await request(app).get("/api/status");
      expect(response.body.services).toHaveProperty("stellarRpc");
      expect(response.body.services.stellarRpc).toHaveProperty("status");
    });

    test("should include total check duration", async () => {
      const response = await request(app).get("/api/status");
      expect(response.body).toHaveProperty("totalCheckDuration");
      expect(typeof response.body.totalCheckDuration).toBe("number");
    });

    test("should track overall health status", async () => {
      const response = await request(app).get("/api/status");
      const validStatuses = ["healthy", "degraded", "error"];
      expect(validStatuses).toContain(response.body.status);
    });
  });

  describe("GET /api/status/database", () => {
    test("should return database-only status", async () => {
      const response = await request(app).get("/api/status/database");
      expect(response.body).toHaveProperty("status");
      expect(response.body).toHaveProperty("database");
    });

    test("should check database connectivity", async () => {
      const response = await request(app).get("/api/status/database");
      const validStatuses = ["healthy", "unhealthy"];
      expect(validStatuses).toContain(response.body.status);
    });
  });

  describe("GET /api/status/stellar", () => {
    test("should return Stellar-only status", async () => {
      const response = await request(app).get("/api/status/stellar");
      expect(response.body).toHaveProperty("status");
      expect(response.body).toHaveProperty("service");
    });

    test("should identify network type", async () => {
      const response = await request(app).get("/api/status/stellar");
      if (response.body.status === "healthy") {
        expect(response.body).toHaveProperty("network");
        expect(["testnet", "mainnet"]).toContain(response.body.network);
      }
    });

    test("should report latest ledger when healthy", async () => {
      const response = await request(app).get("/api/status/stellar");
      if (response.body.status === "healthy") {
        expect(response.body).toHaveProperty("latestLedger");
        expect(typeof response.body.latestLedger).toBe("number");
      }
    });
  });

  describe("Error Handling", () => {
    test("should handle errors gracefully on status endpoint", async () => {
      const response = await request(app).get("/api/status");
      expect([200, 503]).toContain(response.status);
    });
  });
});