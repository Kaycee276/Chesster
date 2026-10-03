const request = require("supertest");
const express = require("express");
const {
  detectTorAndProxy,
  isTorExitNode,
  refreshTorExitList,
  addMockTorIp,
  clearMockTorIps,
  normalizeIp,
} = require("../middlewares/proxyDetection");
const axios = require("axios");

jest.mock("axios");

describe("Tor & VPN Proxy Detection Middleware (Issue #326)", () => {
  let app;
  const TOR_EXIT_IP = "185.220.101.5";
  const CLEAN_USER_IP = "203.0.113.195";

  beforeEach(() => {
    clearMockTorIps();
    addMockTorIp(TOR_EXIT_IP);

    app = express();
    app.use(express.json());

    // Middleware to simulate remote IP header in tests
    app.use((req, res, next) => {
      const testIp = req.headers["x-test-ip"];
      if (testIp) {
        req.headers["x-forwarded-for"] = testIp;
      }
      next();
    });

    app.post("/api/games", detectTorAndProxy(), (req, res) => {
      res.status(201).json({ success: true, gameCode: "chess-456" });
    });

    app.post("/api/games/:gameCode/join", detectTorAndProxy(), (req, res) => {
      res.status(200).json({ success: true, joined: true });
    });
  });

  afterEach(() => {
    clearMockTorIps();
    jest.clearAllMocks();
  });

  describe("IP normalization and membership checks", () => {
    test("normalizes IPv6 mapped IPv4 and port formats", () => {
      expect(normalizeIp("::ffff:185.220.101.5")).toBe("185.220.101.5");
      expect(normalizeIp("185.220.101.5:443")).toBe("185.220.101.5");
      expect(normalizeIp("  185.220.101.5  ")).toBe("185.220.101.5");
    });

    test("accurately identifies Tor exit node in set", async () => {
      expect(await isTorExitNode(TOR_EXIT_IP)).toBe(true);
      expect(await isTorExitNode(CLEAN_USER_IP)).toBe(false);
    });
  });

  describe("Wagered Matches vs Casual Practice Games", () => {
    test("blocks wager match creation originating from a Tor exit node with 403 PROXY_DETECTED", async () => {
      const res = await request(app)
        .post("/api/games")
        .set("x-test-ip", TOR_EXIT_IP)
        .send({
          playerColor: "white",
          timeControl: "5+3",
          wagerAmount: 50,
          tokenAddress: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe("PROXY_DETECTED");
      expect(res.body.message).toMatch(/Tor and anonymized proxies are not permitted/i);
    });

    test("allows casual (free) practice games even when originating from a Tor exit node", async () => {
      const res = await request(app)
        .post("/api/games")
        .set("x-test-ip", TOR_EXIT_IP)
        .send({
          playerColor: "white",
          timeControl: "5+3",
          wagerAmount: 0,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    test("allows wager match creation for regular non-Tor IPs", async () => {
      const res = await request(app)
        .post("/api/games")
        .set("x-test-ip", CLEAN_USER_IP)
        .send({
          playerColor: "white",
          timeControl: "5+3",
          wagerAmount: 100,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    test("blocks joining a wagered match from a Tor exit node", async () => {
      const res = await request(app)
        .post("/api/games/chess-456/join")
        .set("x-test-ip", TOR_EXIT_IP)
        .send({
          playerAddress: "GBXGQ...",
          wagerAmount: 25,
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe("PROXY_DETECTED");
    });
  });

  describe("refreshTorExitList", () => {
    test("successfully fetches and populates Tor exit nodes", async () => {
      axios.get.mockResolvedValueOnce({
        data: "185.220.101.5\n185.220.101.6\n# Comment line\n185.220.101.7\n",
      });

      const result = await refreshTorExitList();
      expect(result.success).toBe(true);
      expect(result.count).toBe(3);
      expect(await isTorExitNode("185.220.101.6")).toBe(true);
      expect(await isTorExitNode("185.220.101.7")).toBe(true);
    });

    test("handles network failures gracefully", async () => {
      axios.get.mockRejectedValueOnce(new Error("Network connection timeout"));

      const result = await refreshTorExitList();
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Network connection timeout/);
    });
  });
});
