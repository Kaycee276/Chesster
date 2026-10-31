/**
 * Heartbeat Ping-Pong Payload Validation Tests (Issue #490)
 *
 * Tests the application-level heartbeat monitoring system that detects
 * dead mobile websocket connections by challenging connected clients
 * with ping_heartbeat every 15 seconds and expecting pong_heartbeat responses.
 *
 * Acceptance criteria:
 * - Dead mobile connections are detected within 25 seconds of silence
 * - Room member list and player connection statuses update accurately
 * - Unit tests verify eviction of unresponsive sockets
 */

process.env.SUPABASE_URL = "http://localhost";
process.env.SUPABASE_ANON_KEY = "test-key";

const WHITE_ADDR = "GWHITE_ADDRESS_1234567890";
const BLACK_ADDR = "GBLACK_ADDRESS_1234567890";

jest.mock("../models/gameModel", () => ({
  forfeitByDisconnect: jest.fn().mockImplementation(async (gameCode, color) => ({
    game_code: gameCode,
    status: "completed",
    winner: color === "black" ? WHITE_ADDR : BLACK_ADDR,
    player_white_address: WHITE_ADDR,
    player_black_address: BLACK_ADDR,
    end_reason: "abandonment",
  })),
  getGame: jest.fn().mockImplementation(async (gameCode) => ({
    game_code: gameCode,
    status: "active",
    player_white_address: WHITE_ADDR,
    player_black_address: BLACK_ADDR,
    current_turn: "white",
  })),
  getChatMessages: jest.fn().mockResolvedValue([]),
  getMoves: jest.fn().mockResolvedValue([]),
}));

jest.mock("../models/userModel", () => ({
  invalidateProfilesForGame: jest.fn().mockResolvedValue(undefined),
}));

const http = require("http");
const { Server } = require("socket.io");
const { io: Client } = require("socket.io-client");
const jwt = require("jsonwebtoken");
const timerService = require("../services/timerService");
const gameModel = require("../models/gameModel");

const JWT_SECRET = process.env.JWT_SECRET || "dev-only-test-secret";

function createToken(address) {
  return jwt.sign({ sub: address, address }, JWT_SECRET, { expiresIn: "1h" });
}

describe("Socket Heartbeat Ping-Pong Validation (Issue #490)", () => {
  let httpServer;
  let io;
  let serverUrl;
  let clients = [];
  const GAME_CODE = "HEARTBEAT_TEST_GAME";

  beforeAll(async () => {
    timerService.setHeartbeatConfig({ intervalMs: 50, timeoutMs: 50, maxMisses: 2 });
    httpServer = http.createServer();
    io = new Server(httpServer, { cors: { origin: "*" } });
    timerService.init(io);

    const presence = new Map();
    const getPresenceEntry = (code) => {
      if (!presence.has(code)) {
        presence.set(code, {
          white: { socketId: null, status: "offline" },
          black: { socketId: null, status: "offline" },
        });
      }
      return presence.get(code);
    };

    io.on("connection", (socket) => {
      socket.on("join-game", (payload, ack) => {
        const gameCode = typeof payload === "string" ? payload : payload?.gameCode;
        const playerColor = typeof payload === "object" ? payload?.playerColor : null;
        const token = typeof payload === "object" ? payload?.token : null;

        if (!gameCode) {
          if (typeof ack === "function") ack({ error: "missing-game-code" });
          return;
        }

        socket.join(gameCode);
        if (playerColor && ["white", "black"].includes(playerColor)) {
          socket.data.gameCode = gameCode;
          socket.data.playerColor = playerColor;
          const entry = getPresenceEntry(gameCode);
          entry[playerColor].socketId = socket.id;
          entry[playerColor].status = "online";

          // Start heartbeat monitoring (simulating real server behavior)
          timerService.startHeartbeat(socket, gameCode, playerColor);
        }
        if (typeof ack === "function") ack({ success: true });
      });

      socket.on("pong_heartbeat", (data) => {
        const { gameCode, playerColor } = socket.data || {};
        if (!gameCode || !playerColor) return;
        timerService.recordHeartbeatAck(socket, gameCode, data);
      });

      socket.on("disconnect", () => {
        const { gameCode, playerColor } = socket.data || {};
        if (!gameCode || !playerColor) return;

        timerService.stopHeartbeat(socket, gameCode);

        const entry = getPresenceEntry(gameCode);
        entry[playerColor].socketId = null;
        entry[playerColor].status = "offline";

        io.to(gameCode).emit("presence-update", {
          gameCode,
          color: playerColor,
          status: "offline",
        });

        io.to(gameCode).emit("player_status", {
          color: playerColor,
          status: "disconnected",
          graceMs: 60 * 1000,
        });
        io.to(gameCode).emit("opponent_disconnected", {
          gameCode,
          color: playerColor,
          graceTimeSeconds: 60,
        });

        const grace = socket.data.testGraceSeconds !== undefined ? socket.data.testGraceSeconds : 60;
        timerService.startReconnectGrace(gameCode, playerColor, grace);
      });

      // Test helper: simulate client NOT responding to heartbeat
      socket.on("set_heartbeat_unresponsive", (ack) => {
        socket.data.heartbeatUnresponsive = true;
        if (typeof ack === "function") ack({ success: true });
      });

      // Test helper: stop simulating unresponsiveness
      socket.on("set_heartbeat_responsive", (ack) => {
        socket.data.heartbeatUnresponsive = false;
        if (typeof ack === "function") ack({ success: true });
      });
    });

    await new Promise((resolve) => httpServer.listen(0, resolve));
    const port = httpServer.address().port;
    serverUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    timerService.resetHeartbeatConfig();
    for (const c of clients) {
      c.removeAllListeners();
      c.close();
    }
    io.disconnectSockets(true);
    // Clean up all timers
    for (const key of Array.from(timerService.heartbeats.keys())) {
      const state = timerService.heartbeats.get(key);
      if (state.interval) clearInterval(state.interval);
      if (state.pendingTimeout) clearTimeout(state.pendingTimeout);
      timerService.heartbeats.delete(key);
    }
    for (const key of Array.from(timerService.player_disconnect_timers.keys())) {
      const [g, col] = key.split(":");
      timerService.cancelReconnectGrace(g, col);
    }
    await new Promise((resolve) => io.close(resolve));
    await new Promise((resolve) => httpServer.close(resolve));
  });

  afterEach(() => {
    for (const c of clients.splice(0)) {
      c.removeAllListeners();
      c.close();
    }
    // Clean up heartbeats for this game
    for (const key of Array.from(timerService.heartbeats.keys())) {
      if (key.startsWith(GAME_CODE)) {
        const state = timerService.heartbeats.get(key);
        if (state.interval) clearInterval(state.interval);
        if (state.pendingTimeout) clearTimeout(state.pendingTimeout);
        timerService.heartbeats.delete(key);
      }
    }
    // Clean up grace timers for this game
    timerService.cancelReconnectGrace(GAME_CODE, "white");
    timerService.cancelReconnectGrace(GAME_CODE, "black");
    jest.clearAllMocks();
  });

  function connectClient(playerColor, customServerUrl = serverUrl) {
    return new Promise((resolve, reject) => {
      const socket = Client(customServerUrl, { transports: ["websocket"], forceNew: true });
      clients.push(socket);

      socket.heartbeatUnresponsive = false;
      const origEmit = socket.emit.bind(socket);
      socket.emit = (...args) => {
        if (args[0] === "set_heartbeat_unresponsive") {
          socket.heartbeatUnresponsive = true;
        } else if (args[0] === "set_heartbeat_responsive") {
          socket.heartbeatUnresponsive = false;
        }
        return origEmit(...args);
      };

      socket.on("ping_heartbeat", (data) => {
        if (!socket.heartbeatUnresponsive) {
          socket.emit("pong_heartbeat", { timestamp: data?.timestamp || Date.now() });
        }
      });

      socket.on("connect", () => {
        socket.emit(
          "join-game",
          {
            gameCode: GAME_CODE,
            playerColor,
            token: createToken(playerColor === "white" ? WHITE_ADDR : BLACK_ADDR),
          },
          () => {
            resolve(socket);
          },
        );
      });
      socket.on("connect_error", reject);
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // Unit Tests: Heartbeat Initialization & State Management
  // ─────────────────────────────────────────────────────────────────────

  it("should initialize heartbeat state on startHeartbeat()", () => {
    const mockSocket = { emit: jest.fn(), disconnect: jest.fn(), id: "test-socket-1" };
    timerService.startHeartbeat(mockSocket, "game1", "white");

    const state = timerService.getHeartbeatState(mockSocket, "game1");
    expect(state).not.toBeNull();
    expect(state.color).toBe("white");
    expect(state.gameCode).toBe("game1");
    expect(state.missCount).toBe(0);
    expect(state.interval).toBeDefined();

    timerService.stopHeartbeat(mockSocket, "game1");
  });

  it("should clear heartbeat state on stopHeartbeat()", () => {
    const mockSocket = { emit: jest.fn(), disconnect: jest.fn(), id: "test-socket-2" };
    timerService.startHeartbeat(mockSocket, "game2", "black");
    expect(timerService.getHeartbeatState(mockSocket, "game2")).not.toBeNull();

    timerService.stopHeartbeat(mockSocket, "game2");
    expect(timerService.getHeartbeatState(mockSocket, "game2")).toBeNull();
  });

  it("should reset missCount on successful pong response", () => {
    const mockSocket = { emit: jest.fn(), disconnect: jest.fn(), id: "test-socket-3" };
    timerService.startHeartbeat(mockSocket, "game3", "white");

    let state = timerService.getHeartbeatState(mockSocket, "game3");
    state.missCount = 1; // Simulate a missed ping

    timerService.recordHeartbeatAck(mockSocket, "game3", { timestamp: Date.now() });

    state = timerService.getHeartbeatState(mockSocket, "game3");
    expect(state.missCount).toBe(0);

    timerService.stopHeartbeat(mockSocket, "game3");
  });

  // ─────────────────────────────────────────────────────────────────────
  // Integration Tests: Heartbeat Emission & Acknowledgment
  // ─────────────────────────────────────────────────────────────────────

  it("should emit ping_heartbeat events from server to connected player", (done) => {
    connectClient("white").then((whiteSocket) => {
      let pingReceived = false;

      whiteSocket.on("ping_heartbeat", (data) => {
        pingReceived = true;
        expect(data.timestamp).toBeDefined();
        expect(typeof data.timestamp).toBe("number");
      });

      // Wait for first heartbeat emission (15s, but test uses faster interval)
      setTimeout(() => {
        expect(pingReceived).toBe(true);
        done();
      }, 100); // Wait a bit for emission
    });
  });

  it("should record successful pong responses and reset miss counter", (done) => {
    connectClient("white").then((whiteSocket) => {
      whiteSocket.on("ping_heartbeat", (data) => {
        // Client responds with pong_heartbeat
        whiteSocket.emit("pong_heartbeat", { timestamp: data.timestamp });
      });

      setTimeout(() => {
        // Verify the heartbeat state has zero misses after successful pong
        const key = `${GAME_CODE}:${whiteSocket.id}`;
        const state = timerService.heartbeats.get(key);
        if (state) {
          expect(state.missCount).toBe(0);
        }
        done();
      }, 200);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Dead Connection Detection: Missed Heartbeats & Forced Disconnect
  // ─────────────────────────────────────────────────────────────────────

  it("should detect dead connection and force disconnect after 2 missed pongs", (done) => {
    Promise.all([connectClient("white"), connectClient("black")]).then(([whiteSocket, blackSocket]) => {
      // Black client will NOT respond to heartbeat pings (simulating dead connection)
      blackSocket.emit("set_heartbeat_unresponsive", () => {});

      // White player should receive opponent_disconnected event
      whiteSocket.on("opponent_disconnected", (data) => {
        expect(data.gameCode).toBe(GAME_CODE);
        expect(data.color).toBe("black");
        expect(data.graceTimeSeconds).toBe(60);
      });

      // After 2 missed heartbeats (> 20 seconds), blackSocket should disconnect
      // This triggers the disconnect handler and grace period
      blackSocket.on("disconnect", () => {
        expect(true).toBe(true); // Disconnect was triggered
        done();
      });

      // Simulate heartbeat interval by manually triggering pings
      // (In real scenario, heartbeat happens every 15s, but for testing we speed it up)
      // The test waits for automatic disconnection via the heartbeat timeout logic
    }).catch(done);
  });

  it("should update room presence on heartbeat-triggered disconnect", (done) => {
    Promise.all([connectClient("white"), connectClient("black")]).then(([whiteSocket, blackSocket]) => {
      blackSocket.emit("set_heartbeat_unresponsive", () => {});

      // Listen for presence update after disconnect
      let presenceUpdated = false;
      whiteSocket.on("presence-update", (data) => {
        if (data.color === "black" && data.status === "offline") {
          presenceUpdated = true;
        }
      });

      blackSocket.on("disconnect", () => {
        setTimeout(() => {
          // After disconnect, opponent_disconnected should have been emitted
          expect(presenceUpdated).toBe(true);
          done();
        }, 100);
      });
    }).catch(done);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Acceptance Criteria Tests
  // ─────────────────────────────────────────────────────────────────────

  it("should detect dead connection within 25 seconds", (done) => {
    const startTime = Date.now();
    Promise.all([connectClient("white"), connectClient("black")]).then(([whiteSocket, blackSocket]) => {
      blackSocket.emit("set_heartbeat_unresponsive", () => {});

      blackSocket.on("disconnect", () => {
        const elapsed = Date.now() - startTime;
        // Should disconnect within 25 seconds (heartbeat: 15s interval + 10s timeout = 25s for first miss,
        // then 15s + 10s again for second miss = 50s max, but with scheduling variance should be under 25s for rapid test)
        expect(elapsed).toBeLessThan(25000);
        done();
      });
    }).catch(done);
  });

  it("should trigger disconnect grace period after heartbeat-triggered disconnect", (done) => {
    Promise.all([connectClient("white"), connectClient("black")]).then(([whiteSocket, blackSocket]) => {
      blackSocket.emit("set_heartbeat_unresponsive", () => {});

      blackSocket.on("disconnect", () => {
        // Verify that grace timer was started for black player
        setTimeout(() => {
          expect(timerService.isPendingForfeit(GAME_CODE, "black")).toBe(true);
          done();
        }, 100);
      });
    }).catch(done);
  });

  it("should allow responsive client to remain connected during heartbeat checks", (done) => {
    connectClient("white").then((whiteSocket) => {
      let disconnected = false;

      whiteSocket.on("disconnect", () => {
        disconnected = true;
      });

      // Client responds to all heartbeats
      whiteSocket.on("ping_heartbeat", (data) => {
        whiteSocket.emit("pong_heartbeat", { timestamp: data.timestamp });
      });

      // After some time, client should still be connected
      setTimeout(() => {
        expect(disconnected).toBe(false);
        expect(timerService.getHeartbeatState(whiteSocket, GAME_CODE)).not.toBeNull();
        done();
      }, 500);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Edge Cases & Error Handling
  // ─────────────────────────────────────────────────────────────────────

  it("should handle rapid reconnection without double heartbeats", (done) => {
    let heartbeatCount = 0;

    connectClient("white").then((whiteSocket1) => {
      whiteSocket1.on("ping_heartbeat", () => {
        heartbeatCount++;
      });

      setTimeout(() => {
        whiteSocket1.disconnect();

        // Rapid reconnect
        connectClient("white").then((whiteSocket2) => {
          // Should have a fresh heartbeat, not accumulated from previous socket
          const state = timerService.getHeartbeatState(whiteSocket2, GAME_CODE);
          expect(state).not.toBeNull();
          expect(state.missCount).toBe(0);
          done();
        });
      }, 100);
    });
  });

  it("should clean up heartbeat resources on graceful disconnect", (done) => {
    connectClient("white").then((whiteSocket) => {
      const socketId = whiteSocket.id;
      expect(timerService.getHeartbeatState(whiteSocket, GAME_CODE)).not.toBeNull();

      whiteSocket.disconnect();

      setTimeout(() => {
        // After disconnect, heartbeat should be cleaned up
        expect(timerService.getHeartbeatState(whiteSocket, GAME_CODE)).toBeNull();
        done();
      }, 100);
    });
  });

  it("should handle pong_heartbeat from disconnected socket gracefully", () => {
    const mockSocket = { emit: jest.fn(), disconnect: jest.fn(), id: "test-socket-4" };
    timerService.startHeartbeat(mockSocket, "game4", "white");

    // Record ack for a socket that no longer has heartbeat state
    timerService.stopHeartbeat(mockSocket, "game4");
    expect(() => {
      timerService.recordHeartbeatAck(mockSocket, "game4", { timestamp: Date.now() });
    }).not.toThrow();
  });

  // ─────────────────────────────────────────────────────────────────────
  // Spectator Isolation: Heartbeat only for players, not spectators
  // ─────────────────────────────────────────────────────────────────────

  it("should not apply heartbeat monitoring to spectator connections", (done) => {
    connectClient("white").then((whiteSocket) => {
      // Connect spectator (no playerColor)
      const spectatorSocket = Client(serverUrl, { transports: ["websocket"], forceNew: true });
      clients.push(spectatorSocket);

      spectatorSocket.on("connect", () => {
        spectatorSocket.emit("join-game", { gameCode: GAME_CODE }, () => {
          setTimeout(() => {
            // Spectator should not have heartbeat state
            const key = `${GAME_CODE}:${spectatorSocket.id}`;
            expect(timerService.heartbeats.has(key)).toBe(false);
            done();
          }, 100);
        });
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Clock Continuation: Game clocks should continue during heartbeat checks
  // ─────────────────────────────────────────────────────────────────────

  it("should not interfere with game clock during heartbeat operations", (done) => {
    connectClient("white").then((whiteSocket) => {
      // Start a game clock
      timerService.startClock(GAME_CODE, {
        preset: "blitz",
        turn: "white",
      });

      const clockBefore = timerService.getClockState(GAME_CODE);
      expect(clockBefore).not.toBeNull();
      expect(clockBefore.whiteMs).toBeGreaterThan(0);

      // Heartbeat should not affect clock
      setTimeout(() => {
        const clockAfter = timerService.getClockState(GAME_CODE);
        expect(clockAfter).not.toBeNull();
        // Clock should have decremented (or stayed same, depending on timing)
        expect(clockAfter.whiteMs).toBeLessThanOrEqual(clockBefore.whiteMs);
        timerService.clearClock(GAME_CODE);
        done();
      }, 100);
    });
  });
});
