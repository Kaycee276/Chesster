/**
 * Tests for Health Check and Service Status Monitoring
 */

const request = require("supertest");
const express = require("express");

// Keep route tests independent of the SDK's ESM-only transitive hash module.
jest.mock("@stellar/stellar-sdk", () => ({
  Networks: { TESTNET: "Test SDF Network ; September 2015" },
  rpc: { Server: jest.fn(() => ({ getLatestLedger: jest.fn().mockResolvedValue({ sequence: 1 }) })) },
}));

jest.mock("../config/supabase", () => ({
  from: jest.fn(() => ({
    select: jest.fn(() => ({
      limit: jest.fn().mockResolvedValue({ data: [{ count: 1 }], error: null }),
    })),
  })),
}));

jest.mock("../config/redis", () => ({
  getRedisConnection: jest.fn().mockResolvedValue({
    ping: jest.fn().mockResolvedValue("PONG"),
  }),
}));

const { checkDbHealth, clearDbHealthCache } = require("../services/dbHealthService");
const healthRoutes = require("../routes/healthRoutes");

describe("Health Check Routes", () => {
  let app;

  beforeEach(() => {
    // Other suites exercise missing configuration and may mutate process.env.
    // Restore the route test's safe configuration for every test in this file.
    process.env.SUPABASE_URL = "http://localhost";
    process.env.SUPABASE_ANON_KEY = "test-anon-key";
    process.env.SUPABASE_KEY = "test-service-key";
    process.env.SOROBAN_RPC_URL = "http://localhost";
    app = express();
    app.use(express.json());
    app.use("/api", healthRoutes);
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

    test("should return 503 if services are degraded", async () => {
      // Note: This depends on actual service availability
      // The actual status code depends on whether Supabase and Stellar RPC are available
      const response = await request(app).get("/api/status");
      
      expect([200, 503]).toContain(response.status);
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

    test("should include response time for database", async () => {
      const response = await request(app).get("/api/status/database");
      
      if (response.body.status === "healthy") {
        expect(response.body).toHaveProperty("responseTime");
        expect(typeof response.body.responseTime).toBe("number");
      }
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

    test("should check RPC connectivity", async () => {
      const response = await request(app).get("/api/status/stellar");
      
      const validStatuses = ["healthy", "unhealthy"];
      expect(validStatuses).toContain(response.body.status);
    });

    test("should report latest ledger when healthy", async () => {
      const response = await request(app).get("/api/status/stellar");
      
      if (response.body.status === "healthy") {
        expect(response.body).toHaveProperty("latestLedger");
        expect(typeof response.body.latestLedger).toBe("number");
      }
    });

    test("should include response time", async () => {
      const response = await request(app).get("/api/status/stellar");
      
      if (response.body.status === "healthy") {
        expect(response.body).toHaveProperty("responseTime");
        expect(typeof response.body.responseTime).toBe("number");
      }
    });
  });

  describe("Error Handling", () => {
    test("should handle errors gracefully on status endpoint", async () => {
      const response = await request(app).get("/api/status");
      
      // Should return a response even if services fail
      expect([200, 503]).toContain(response.status);
    });

    test("should include error messages when services fail", async () => {
      const response = await request(app).get("/api/status");
      
      if (response.body.status !== "healthy") {
        // Services might have errors
        expect(response.body).toHaveProperty("services");
      }
    });
  });

  describe("GET /api/health/liveness", () => {
    test("should return 200 with uptimeSeconds, memoryUsage, and timestamp without querying db/redis", async () => {
      const response = await request(app).get("/api/health/liveness");
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("status", "ok");
      expect(response.body).toHaveProperty("uptimeSeconds");
      expect(typeof response.body.uptimeSeconds).toBe("number");
      expect(response.body).toHaveProperty("memoryUsage");
      expect(response.body.memoryUsage).toHaveProperty("heapUsed");
      expect(response.body).toHaveProperty("timestamp");
    });
  });

  describe("GET /api/health/readiness", () => {
    beforeEach(() => {
      clearDbHealthCache();
    });

    test("should return 200 when database and redis are healthy", async () => {
      const response = await request(app).get("/api/health/readiness");
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("status", "healthy");
      expect(response.body.dependencies.database.status).toBe("healthy");
      expect(response.body.dependencies.redis.status).toBe("healthy");
    });

    test("should return 503 when database is unhealthy", async () => {
      const dbMock = require("../config/supabase");
      const originalFrom = dbMock.from;
      dbMock.from = jest.fn(() => ({
        select: jest.fn(() => ({
          limit: jest.fn().mockResolvedValue({ data: null, error: { message: "DB connection timeout" } }),
        })),
      }));

      try {
        const response = await request(app).get("/api/health/readiness");
        expect(response.status).toBe(503);
        expect(response.body.status).toBe("unhealthy");
        expect(response.body.dependencies.database.status).toBe("unhealthy");
      } finally {
        dbMock.from = originalFrom;
        clearDbHealthCache();
      }
    });

    test("should return 503 when redis is unhealthy", async () => {
      const redisConfig = require("../config/redis");
      const originalGetRedis = redisConfig.getRedisConnection;
      process.env.REDIS_URL = "redis://localhost:6379";
      redisConfig.getRedisConnection = jest.fn().mockResolvedValue({
        ping: jest.fn().mockRejectedValue(new Error("Redis offline")),
      });

      try {
        const response = await request(app).get("/api/health/readiness");
        expect(response.status).toBe(503);
        expect(response.body.status).toBe("unhealthy");
        expect(response.body.dependencies.redis.status).toBe("unhealthy");
      } finally {
        delete process.env.REDIS_URL;
        redisConfig.getRedisConnection = originalGetRedis;
      }
    });
  });

  describe("GET /api/health/detailed", () => {
    beforeEach(() => {
      clearDbHealthCache();
    });

    test("should return detailed health status with 200", async () => {
      const response = await request(app).get("/api/health/detailed");
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("status", "healthy");
      expect(response.body).toHaveProperty("services");
      expect(response.body.services).toHaveProperty("database");
      expect(response.body.services).toHaveProperty("redis");
      expect(response.body.services).toHaveProperty("stellarRpc");
    });
  });

  describe("dbHealthService in-memory TTL caching (3 seconds)", () => {
    beforeEach(() => {
      clearDbHealthCache();
    });

    test("should return cached result on consecutive calls within 3 seconds", async () => {
      let queryCount = 0;
      const customClient = {
        from: jest.fn(() => ({
          select: jest.fn(() => ({
            limit: jest.fn().mockImplementation(async () => {
              queryCount++;
              return { data: [{ id: 1 }], error: null };
            }),
          })),
        })),
      };

      const first = await checkDbHealth({ client: customClient });
      expect(first.status).toBe("healthy");
      expect(queryCount).toBe(1);

      // Second immediate call within 3 seconds should use cache
      const second = await checkDbHealth({ client: customClient });
      expect(second.status).toBe("healthy");
      expect(second.cached).toBe(true);
      expect(queryCount).toBe(1); // No new DB call!

      // When bypassCache is true, a fresh call is made
      const third = await checkDbHealth({ client: customClient, bypassCache: true });
      expect(third.status).toBe("healthy");
      expect(queryCount).toBe(2);
    });
  });
});
