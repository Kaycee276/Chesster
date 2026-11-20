/**
 * Tests for Prometheus Metrics Exporter (Issue #659)
 */

const request = require("supertest");
const express = require("express");
const metricsRoutes = require("../routes/metricsRoutes");
const matchmakingService = require("../services/matchmakingService");

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

    test("should include matchmaking wait seconds histogram in metrics output (Issue #659)", async () => {
      const response = await request(app).get("/api/metrics");
      expect(response.text).toContain("chesster_matchmaking_wait_seconds");
      expect(response.text).toContain("chesster_matchmaking_wait_seconds_bucket");
    });

    test("should include active games gauge partitioned by variant in metrics output (Issue #659)", async () => {
      const response = await request(app).get("/api/metrics");
      expect(response.text).toContain("chesster_active_games_total");
      expect(response.text).toContain('chesster_active_games_total{variant="standard"}');
      expect(response.text).toContain('chesster_active_games_total{variant="blitz"}');
      expect(response.text).toContain('chesster_active_games_total{variant="bullet"}');
    });

    test("should include connected spectators total gauge in metrics output (Issue #659)", async () => {
      const response = await request(app).get("/api/metrics");
      expect(response.text).toContain("chesster_connected_spectators_total");
    });
  });

  describe("Custom Metric Collectors & Helpers (Issue #659)", () => {
    test("should expose all new metric collectors and helper functions", () => {
      expect(metricsRoutes.matchmakingWaitHistogram).toBeDefined();
      expect(typeof metricsRoutes.matchmakingWaitHistogram.observe).toBe("function");
      expect(metricsRoutes.activeGamesGauge).toBeDefined();
      expect(typeof metricsRoutes.activeGamesGauge.set).toBe("function");
      expect(metricsRoutes.connectedSpectatorsGauge).toBeDefined();
      expect(typeof metricsRoutes.connectedSpectatorsGauge.set).toBe("function");

      expect(typeof metricsRoutes.observeMatchmakingWait).toBe("function");
      expect(typeof metricsRoutes.setActiveGames).toBe("function");
      expect(typeof metricsRoutes.updateActiveGames).toBe("function");
      expect(typeof metricsRoutes.setConnectedSpectators).toBe("function");
      expect(typeof metricsRoutes.markSpectatorConnected).toBe("function");
      expect(typeof metricsRoutes.markSpectatorDisconnected).toBe("function");
    });

    test("observeMatchmakingWait records wait times into histogram", async () => {
      metricsRoutes.observeMatchmakingWait(7.5);
      const response = await request(app).get("/api/metrics");
      expect(response.text).toContain('chesster_matchmaking_wait_seconds_bucket{le="10"}');
    });

    test("setActiveGames updates gauge for specified variant", async () => {
      metricsRoutes.setActiveGames("blitz", 4);
      metricsRoutes.setActiveGames("bullet", 2);
      const response = await request(app).get("/api/metrics");
      expect(response.text).toContain('chesster_active_games_total{variant="blitz"} 4');
      expect(response.text).toContain('chesster_active_games_total{variant="bullet"} 2');
    });

    test("spectator helper functions track connected spectators correctly", async () => {
      metricsRoutes.setConnectedSpectators(5);
      let response = await request(app).get("/api/metrics");
      expect(response.text).toContain("chesster_connected_spectators_total 5");

      metricsRoutes.markSpectatorConnected();
      response = await request(app).get("/api/metrics");
      expect(response.text).toContain("chesster_connected_spectators_total 6");

      metricsRoutes.markSpectatorDisconnected();
      response = await request(app).get("/api/metrics");
      expect(response.text).toContain("chesster_connected_spectators_total 5");
    });

    test("markGameConnected and markGameDisconnected update active games by variant", async () => {
      metricsRoutes.markGameConnected("GAME_BLITZ_1", "blitz");
      metricsRoutes.markGameConnected("GAME_BLITZ_2", "blitz");
      let response = await request(app).get("/api/metrics");
      expect(response.text).toContain('chesster_active_games_total{variant="blitz"} 2');

      metricsRoutes.markGameDisconnected("GAME_BLITZ_1");
      response = await request(app).get("/api/metrics");
      expect(response.text).toContain('chesster_active_games_total{variant="blitz"} 1');

      metricsRoutes.markGameDisconnected("GAME_BLITZ_2");
      response = await request(app).get("/api/metrics");
      expect(response.text).toContain('chesster_active_games_total{variant="blitz"} 0');
    });
  });

  describe("Matchmaking Service Integration (Issue #659)", () => {
    test("pairing players in matchmakingService records queue wait time to histogram", () => {
      const observeSpy = jest.spyOn(metricsRoutes.matchmakingWaitHistogram, "observe");

      const now = Date.now();
      matchmakingService.queue.clear();
      matchmakingService.addToQueue({
        userId: "player_wait_1",
        socketId: "socket_1",
        elo: 1200,
        wagerTier: "free",
        queuedAt: now - 12000, // 12 seconds ago
      });

      const matched = matchmakingService.findMatch(
        {
          userId: "player_wait_2",
          elo: 1200,
          wagerTier: "free",
          queuedAt: now - 4000, // 4 seconds ago
        },
        now
      );

      expect(matched).not.toBeNull();
      expect(observeSpy).toHaveBeenCalled();
      // Should have recorded wait times for both players (around 12s and 4s)
      expect(observeSpy).toHaveBeenCalledWith(expect.closeTo(12, 0.5));
      expect(observeSpy).toHaveBeenCalledWith(expect.closeTo(4, 0.5));

      observeSpy.mockRestore();
    });
  });
});
