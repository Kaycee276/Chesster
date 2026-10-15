process.env.SUPABASE_URL = "http://localhost";
process.env.SUPABASE_ANON_KEY = "test-key";
const WHITE_ADDR = "GWHITE_ADDRESS_1234567890";
const BLACK_ADDR = "GBLACK_ADDRESS_1234567890";

jest.mock("../models/gameModel", () => ({
  forfeitByDisconnect: jest.fn().mockImplementation(async (gameCode, color) => ({
    game_code: gameCode,
    status: "completed",
    winner: color === "black" ? "GWHITE_ADDRESS_1234567890" : "GBLACK_ADDRESS_1234567890",
    player_white_address: "GWHITE_ADDRESS_1234567890",
    player_black_address: "GBLACK_ADDRESS_1234567890",
    end_reason: "abandonment",
  })),
  getGame: jest.fn().mockImplementation(async (gameCode) => ({
    game_code: gameCode,
    status: "active",
    player_white_address: "GWHITE_ADDRESS_1234567890",
    player_black_address: "GBLACK_ADDRESS_1234567890",
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

describe("Disconnect Grace Period & Forfeit Integration", () => {
  let httpServer;
  let io;
  let serverUrl;
  let clients = [];
  const GAME_CODE = "GAME_DISCONNECT_TEST";

  beforeAll(async () => {
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
        if (!gameCode) return;

        socket.join(gameCode);
        if (playerColor && ["white", "black"].includes(playerColor)) {
          socket.data.gameCode = gameCode;
          socket.data.playerColor = playerColor;
          const entry = getPresenceEntry(gameCode);
          entry[playerColor].socketId = socket.id;
          entry[playerColor].status = "online";
        }
        if (typeof ack === "function") ack({ success: true });
      });

      socket.on("disconnect", () => {
        const { gameCode, playerColor } = socket.data || {};
        if (!gameCode || !playerColor) return;

        const entry = getPresenceEntry(gameCode);
        entry[playerColor].socketId = null;
        entry[playerColor].status = "reconnecting";

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

      socket.on("set_test_grace", (seconds, ack) => {
        socket.data.testGraceSeconds = seconds;
        if (typeof ack === "function") ack({ success: true });
      });

      socket.on("reconnect_game", ({ gameId, walletAddress, token }, ack) => {
        try {
          const decoded = jwt.verify(token, JWT_SECRET);
          const tokenAddr = decoded.address || decoded.sub;
          if (tokenAddr !== walletAddress) {
            if (typeof ack === "function") ack("Token mismatch");
            return;
          }

          const playerColor = walletAddress === WHITE_ADDR ? "white" : "black";
          timerService.cancelReconnectGrace(gameId, playerColor);

          socket.join(gameId);
          socket.data.gameCode = gameId;
          socket.data.playerColor = playerColor;

          socket.to(gameId).emit("player_reconnected", {
            gameId,
            color: playerColor,
          });
          socket.to(gameId).emit("opponent_reconnected", {
            gameCode: gameId,
            color: playerColor,
          });

          if (typeof ack === "function") ack(null, { success: true });
        } catch (err) {
          if (typeof ack === "function") ack(err.message);
        }
      });
    });

    await new Promise((resolve) => httpServer.listen(0, resolve));
    const port = httpServer.address().port;
    serverUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    for (const c of clients) {
      c.removeAllListeners();
      c.close();
    }
    io.disconnectSockets(true);
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
    timerService.cancelReconnectGrace(GAME_CODE, "white");
    timerService.cancelReconnectGrace(GAME_CODE, "black");
    jest.clearAllMocks();
  });

  function connectClient(playerColor) {
    return new Promise((resolve, reject) => {
      const socket = Client(serverUrl, { transports: ["websocket"], forceNew: true });
      clients.push(socket);
      socket.on("connect", () => {
        socket.emit("join-game", { gameCode: GAME_CODE, playerColor }, () => {
          resolve(socket);
        });
      });
      socket.on("connect_error", reject);
    });
  }

  it("should start grace period on disconnect and cancel on reconnect (unit test)", () => {
    timerService.startReconnectGrace("game1", "white", 60);
    expect(timerService.isPendingForfeit("game1", "white")).toBe(true);
    timerService.cancelReconnectGrace("game1", "white");
    expect(timerService.isPendingForfeit("game1", "white")).toBe(false);
  });

  it("emits opponent_disconnected with 60s grace when player drops socket", (done) => {
    Promise.all([connectClient("white"), connectClient("black")]).then(([whiteSocket, blackSocket]) => {
      whiteSocket.on("opponent_disconnected", (data) => {
        expect(data.gameCode).toBe(GAME_CODE);
        expect(data.color).toBe("black");
        expect(data.graceTimeSeconds).toBe(60);
        expect(timerService.isPendingForfeit(GAME_CODE, "black")).toBe(true);
        done();
      });

      blackSocket.disconnect();
    });
  });

  it("awards forfeit game_over event to white when grace expires", (done) => {
    Promise.all([connectClient("white"), connectClient("black")]).then(([whiteSocket, blackSocket]) => {
      blackSocket.emit("set_test_grace", 0.05, () => {
        whiteSocket.on("opponent_disconnected", (data) => {
          expect(data.graceTimeSeconds).toBe(60);
        });

        whiteSocket.on("game_over", (overData) => {
          expect(overData.gameCode).toBe(GAME_CODE);
          expect(overData.winner).toBe("white");
          expect(overData.reason).toBe("abandonment");
          expect(gameModel.forfeitByDisconnect).toHaveBeenCalledWith(GAME_CODE, "black");
          expect(timerService.isPendingForfeit(GAME_CODE, "black")).toBe(false);
          done();
        });

        blackSocket.disconnect();
      });
    });
  });

  it("cancels grace timer and emits opponent_reconnected when player reconnects within grace window", (done) => {
    Promise.all([connectClient("white"), connectClient("black")]).then(([whiteSocket, blackSocket]) => {
      blackSocket.emit("set_test_grace", 2, () => {
        whiteSocket.on("opponent_disconnected", () => {
          expect(timerService.isPendingForfeit(GAME_CODE, "black")).toBe(true);

          const blackReconnected = Client(serverUrl, { transports: ["websocket"], forceNew: true });
          clients.push(blackReconnected);

          whiteSocket.on("opponent_reconnected", (data) => {
            expect(data.gameCode).toBe(GAME_CODE);
            expect(data.color).toBe("black");
            expect(timerService.isPendingForfeit(GAME_CODE, "black")).toBe(false);
            done();
          });

          blackReconnected.on("connect", () => {
            blackReconnected.emit(
              "reconnect_game",
              {
                gameId: GAME_CODE,
                walletAddress: BLACK_ADDR,
                token: createToken(BLACK_ADDR),
              },
              (err, res) => {
                expect(err).toBeNull();
                expect(res.success).toBe(true);
              },
            );
          });
        });

        blackSocket.disconnect();
      });
    });
  });
});
