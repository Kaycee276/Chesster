/**
 * Tests for Prometheus Metrics Exporter
 */

const request = require("supertest");
const express = require("express");
const metricsRoutes = require("../routes/metricsRoutes");
const redisConfig = require("../config/redis");

describe("Metrics Routes", () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use("/api", metricsRoutes);
  });

  describe("GET /api/metrics", () => {
    test("should return 200 status", async () => {
      const response = await request(app).get("/api/metrics");
      expect(response.status).toBe(200);
    });

    test("should return correct Content-Type header", async () => {
      const response = await request(app).get("/api/metrics");
      expect(response.headers["content-type"]).toContain("text/plain");
    });

    test("should include default system metrics (CPU, memory)", async () => {
      const response = await request(app).get("/api/metrics");
      
      // Check for common Prometheus metrics that should always be present
      expect(response.text).toContain("process_cpu_user_seconds_total");
      expect(response.text).toContain("process_resident_memory_bytes");
      expect(response.text).toContain("nodejs_eventloop_lag_seconds");
    });

    test("should include active socket connections gauge", async () => {
      const response = await request(app).get("/api/metrics");
      expect(response.text).toContain("socket_active_connections");
    });

    test("should expose the register and gauge objects for server integration", () => {
      expect(metricsRoutes.register).toBeDefined();
      expect(metricsRoutes.activeSocketConnections).toBeDefined();
      expect(typeof metricsRoutes.activeSocketConnections.set).toBe("function");
      expect(metricsRoutes.redisPingLatencyMs).toBeDefined();
      expect(metricsRoutes.redisConnectedClients).toBeDefined();
      expect(metricsRoutes.redisUsedMemoryBytes).toBeDefined();
      expect(metricsRoutes.redisIsConnected).toBeDefined();
      expect(typeof metricsRoutes.collectRedisMetrics).toBe("function");
    });

    test("should include Redis Prometheus gauges in exposition output", async () => {
      const response = await request(app).get("/api/metrics");
      expect(response.status).toBe(200);
      expect(response.text).toContain("chesster_redis_ping_latency_ms");
      expect(response.text).toContain("chesster_redis_connected_clients");
      expect(response.text).toContain("chesster_redis_used_memory_bytes");
      expect(response.text).toContain("chesster_redis_is_connected");
    });
  });

  describe("Redis Pool Metrics Collection", () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    test("should report connected Redis latency, clients, and memory metrics", async () => {
      const mockRedisClient = {
        status: "ready",
        ping: jest.fn().mockResolvedValue("PONG"),
        info: jest.fn().mockImplementation((section) => {
          if (section === "clients") {
            return Promise.resolve("# Clients\r\nconnected_clients:14\r\nblocked_clients:0\r\n");
          }
          if (section === "memory") {
            return Promise.resolve("# Memory\r\nused_memory:2097152\r\nused_memory_human:2.00M\r\n");
          }
          return Promise.resolve("");
        }),
      };

      const health = await metricsRoutes.collectRedisMetrics(mockRedisClient);
      expect(health.connected).toBe(true);
      expect(typeof health.pingLatencyMs).toBe("number");
      expect(health.pingLatencyMs).toBeGreaterThanOrEqual(0);
      expect(health.connectedClients).toBe(14);
      expect(health.usedMemoryBytes).toBe(2097152);

      const metricsText = await metricsRoutes.register.metrics();
      expect(metricsText).toContain("chesster_redis_is_connected 1");
      expect(metricsText).toContain("chesster_redis_connected_clients 14");
      expect(metricsText).toContain("chesster_redis_used_memory_bytes 2097152");
      expect(metricsText).toMatch(/chesster_redis_ping_latency_ms [0-9.]+/);
    });

    test("should report disconnected metrics when Redis client is null or not ready", async () => {
      const nullHealth = await metricsRoutes.collectRedisMetrics(null);
      expect(nullHealth).toEqual({
        connected: false,
        pingLatencyMs: null,
        connectedClients: null,
        usedMemoryBytes: null,
      });

      const notReadyHealth = await metricsRoutes.collectRedisMetrics({ status: "connecting" });
      expect(notReadyHealth.connected).toBe(false);

      const metricsText = await metricsRoutes.register.metrics();
      expect(metricsText).toContain("chesster_redis_is_connected 0");
      expect(metricsText).toContain("chesster_redis_connected_clients 0");
      expect(metricsText).toContain("chesster_redis_used_memory_bytes 0");
      expect(metricsText).toContain("chesster_redis_ping_latency_ms 0");
    });

    test("should handle Redis client errors gracefully without throwing", async () => {
      const erroringClient = {
        status: "ready",
        ping: jest.fn().mockRejectedValue(new Error("Connection reset")),
        info: jest.fn(),
      };

      const health = await metricsRoutes.collectRedisMetrics(erroringClient);
      expect(health).toEqual({
        connected: false,
        pingLatencyMs: null,
        connectedClients: null,
        usedMemoryBytes: null,
      });

      const metricsText = await metricsRoutes.register.metrics();
      expect(metricsText).toContain("chesster_redis_is_connected 0");
    });

    test("should expose connected Redis metrics via GET /api/metrics endpoint", async () => {
      jest.spyOn(redisConfig, "getRedisHealthInfo").mockResolvedValue({
        connected: true,
        pingLatencyMs: 1.75,
        connectedClients: 8,
        usedMemoryBytes: 524288,
      });

      const response = await request(app).get("/api/metrics");
      expect(response.status).toBe(200);
      expect(response.text).toContain("chesster_redis_is_connected 1");
      expect(response.text).toContain("chesster_redis_ping_latency_ms 1.75");
      expect(response.text).toContain("chesster_redis_connected_clients 8");
      expect(response.text).toContain("chesster_redis_used_memory_bytes 524288");
    });
  });
});