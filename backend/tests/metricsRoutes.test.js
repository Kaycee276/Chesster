/**
 * Tests for Prometheus Metrics Exporter
 */

const request = require("supertest");
const express = require("express");
const metricsRoutes = require("../routes/metricsRoutes");

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
    });
  });
});