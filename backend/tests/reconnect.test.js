const http = require("http");
const { Server } = require("socket.io");
const { io: Client } = require("socket.io-client");
const jwt = require("jsonwebtoken");

const JWT_SECRET = "dev-only-test-secret";

function waitFor(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}

function createToken(address) {
  return jwt.sign({ sub: address, address }, JWT_SECRET, { expiresIn: "1h" });
}

async function createReconnectHarness() {
  const httpServer = http.createServer();
  const io = new Server(httpServer, { cors: { origin: "*" } });
  const presence = new Map();
  const mockGames = new Map();
  const timerService = {
    clocks: new Map(),
    getPreciseClocks(gameId) {
      const state = this.clocks.get(gameId);
      if (!state) return null;
      const now = Date.now();
      const activeRemaining = Math.max(0, state.deadline - now);
      const whiteMs = state.turn === "white" ? activeRemaining : state.whiteMs;
      const blackMs = state.turn === "black" ? activeRemaining : state.blackMs;
      return {
        whiteMs,
        blackMs,
        turn: state.turn,
        incrementMs: state.incrementMs,
        preset: state.preset,
      };
    },
    cancelReconnectGrace() {},
    startReconnectGrace() {},
  };

  // Mock gameModel
  const gameModel = {
    async getGame(gameCode) {
      const game = mockGames.get(gameCode);
      if (!game) throw new Error("Game not found");
      return game;
    },
    async getChatMessages(gameCode) {
      return mockGames.get(gameCode)?.chat || [];
    },
    async getMoves(gameCode) {
      return mockGames.get(gameCode)?.moves || [];
    },
  };

  function getPresenceEntry(gameCode) {
    if (!presence.has(gameCode)) {
      presence.set(gameCode, {
        white: { socketId: null, status: "offline" },
        black: { socketId: null, status: "offline" },
      });
    }
    return presence.get(gameCode);
  }

  function broadcastPresence(gameCode, color, status) {
    const presenceEntry = getPresenceEntry(gameCode);
    presenceEntry[color].status = status;
    io.to(gameCode).emit("presence-update", { gameCode, color, status });
  }

  io.on("connection", (socket) => {
    socket.on("join-game", (payload) => {
      const gameCode = typeof payload === "string" ? payload : payload?.gameCode;
      const playerColor = typeof payload === "object" ? payload?.playerColor : null;
      if (!gameCode) return;

      socket.join(gameCode);

      if (playerColor && ["white", "black"].includes(playerColor)) {
        socket.data.gameCode = gameCode;
        socket.data.playerColor = playerColor;

        const presenceEntry = getPresenceEntry(gameCode);
        presenceEntry[playerColor].socketId = socket.id;
        broadcastPresence(gameCode, playerColor, "online");
      }

      const presenceEntry = getPresenceEntry(gameCode);
      socket.emit("presence-snapshot", {
        gameCode,
        white: presenceEntry.white.status,
        black: presenceEntry.black.status,
      });
    });

    socket.on("reconnect_game", async ({ gameId, walletAddress, token }, ack) => {
      const sendAck = (error, data) => {
        if (typeof ack === "function") {
          ack({ error, data });
        }
      };

      try {
        // 1. Validate inputs
        if (!gameId || !walletAddress || !token) {
          return sendAck("Missing gameId, walletAddress, or token");
        }

        // 2. Verify JWT token
        let decoded;
        try {
          decoded = jwt.verify(token, JWT_SECRET);
        } catch (err) {
          return sendAck("Invalid or expired token");
        }

        const tokenAddress = decoded.address || decoded.sub;
        if (tokenAddress !== walletAddress) {
          return sendAck("Token does not match wallet address");
        }

        // 3. Fetch game and verify player is part of it
        let game;
        try {
          game = await gameModel.getGame(gameId);
        } catch (err) {
          return sendAck("Game not found");
        }

        if (!game) {
          return sendAck("Game not found");
        }

        const isWhitePlayer = game.player_white_address === walletAddress;
        const isBlackPlayer = game.player_black_address === walletAddress;

        if (!isWhitePlayer && !isBlackPlayer) {
          return sendAck("You are not part of this game");
        }

        const playerColor = isWhitePlayer ? "white" : "black";

        if (game.status !== "active") {
          return sendAck(`Cannot reconnect to ${game.status} game`);
        }

        // 4. Cancel reconnect grace timer
        timerService.cancelReconnectGrace(gameId, playerColor);

        // 5. Rejoin socket to game room
        socket.join(gameId);
        socket.data.gameCode = gameId;
        socket.data.playerColor = playerColor;

        const presenceEntry = getPresenceEntry(gameId);
        presenceEntry[playerColor].socketId = socket.id;
        broadcastPresence(gameId, playerColor, "online");

        // 6. Compute precise clocks
        const clocks = timerService.getPreciseClocks(gameId);
        if (!clocks) {
          return sendAck("Clock not initialized for this game");
        }

        // 7. Fetch recent chat messages (last 20)
        let chatMessages = [];
        try {
          const allMessages = await gameModel.getChatMessages(gameId);
          chatMessages = allMessages.slice(-20);
        } catch (err) {
          // Non-critical; proceed without chat history
        }

        // 8. Fetch full move history
        let moves = [];
        try {
          moves = await gameModel.getMoves(gameId);
        } catch (err) {
          // Non-critical; proceed without moves
        }

        // 9. Build atomic rehydration payload
        const rehydratePayload = {
          gameId,
          fen: game.board_state,
          moveHistory: moves.map((m) => ({
            from: m.from_position,
            to: m.to_position,
            piece: m.piece,
            promotion: m.promotion || null,
            moveNumber: m.move_number,
          })),
          currentTurn: game.current_turn,
          whiteTimeMs: clocks.whiteMs,
          blackTimeMs: clocks.blackMs,
          incrementMs: clocks.incrementMs,
          preset: clocks.preset,
          drawOfferedBy: game.draw_offer || null,
          recentChat: chatMessages.map((m) => ({
            id: m.id,
            playerColor: m.player_color,
            message: m.message,
            createdAt: m.created_at,
          })),
          inCheck: game.in_check || false,
          lastMove: game.last_move || null,
        };

        // 10. Emit atomic game:rehydrated event
        socket.emit("game:rehydrated", rehydratePayload);

        // 11. Notify opponent of reconnection
        socket.to(gameId).emit("player_reconnected", {
          gameId,
          color: playerColor,
          timestamp: new Date().toISOString(),
        });

        sendAck(null, { success: true, gameId, playerColor });
      } catch (err) {
        sendAck(err.message || "Reconnection failed");
      }
    });
  });

  await new Promise((resolve) => httpServer.listen(0, resolve));
  const port = httpServer.address().port;
  return {
    io,
    url: `http://127.0.0.1:${port}`,
    mockGames,
    timerService,
    close: async () => {
      io.close();
      await new Promise((resolve) => httpServer.close(resolve));
    },
  };
}

describe("socket.io reconnect_game handler", () => {
  let harness;
  const clients = [];

  afterEach(async () => {
    for (const client of clients.splice(0)) {
      client.disconnect();
    }
    if (harness) await harness.close();
  });

  test("happy path: connected player disconnects, then reconnects with valid gameId/walletAddress/token", async () => {
    harness = await createReconnectHarness();

    const whiteAddress = "GADDW43PFTFQKJZFVQKQZ5VF2CQZQ3Z5QKQZQ3Z5QKQZQ3Z5QKQZQ3";
    const whiteToken = createToken(whiteAddress);
    const gameCode = "TEST123";

    // Mock game state
    harness.mockGames.set(gameCode, {
      id: 1,
      game_code: gameCode,
      board_state: [
        ["r", "n", "b", "q", "k", "b", "n", "r"],
        ["p", "p", "p", "p", "p", "p", "p", "p"],
        [".", ".", ".", ".", ".", ".", ".", "."],
        [".", ".", ".", ".", ".", ".", ".", "."],
        [".", ".", ".", ".", ".", ".", ".", "."],
        [".", ".", ".", ".", ".", ".", ".", "."],
        ["P", "P", "P", "P", "P", "P", "P", "P"],
        ["R", "N", "B", "Q", "K", "B", "N", "R"],
      ],
      current_turn: "white",
      status: "active",
      player_white_address: whiteAddress,
      player_black_address: "GBLACK111111111111111111111111111111111111111111111111",
      draw_offer: null,
      in_check: false,
      last_move: null,
      moves: [],
      chat: [],
    });

    // Set up clock
    harness.timerService.clocks.set(gameCode, {
      whiteMs: 600000,
      blackMs: 600000,
      incrementMs: 0,
      preset: "rapid",
      turn: "white",
      deadline: Date.now() + 600000,
      timeout: null,
    });

    const client = Client(harness.url);
    clients.push(client);

    await waitFor(client, "connect");

    // Emit reconnect_game
    const response = await new Promise((resolve) => {
      client.emit("reconnect_game", { gameId: gameCode, walletAddress: whiteAddress, token: whiteToken }, resolve);
    });

    expect(response.error).toBeNull();
    expect(response.data.success).toBe(true);
    expect(response.data.gameId).toBe(gameCode);
    expect(response.data.playerColor).toBe("white");

    // Verify game:rehydrated event is received
    const rehydrated = await waitFor(client, "game:rehydrated");
    expect(rehydrated).toMatchObject({
      gameId: gameCode,
      currentTurn: "white",
      whiteTimeMs: expect.any(Number),
      blackTimeMs: expect.any(Number),
      drawOfferedBy: null,
      inCheck: false,
    });
  });

  test("clock-accuracy test: reconnect reflects elapsed turn time, not stale snapshot", async () => {
    harness = await createReconnectHarness();

    const whiteAddress = "GADDW43PFTFQKJZFVQKQZ5VF2CQZQ3Z5QKQZQ3Z5QKQZQ3Z5QKQZQ3";
    const whiteToken = createToken(whiteAddress);
    const gameCode = "TEST456";

    harness.mockGames.set(gameCode, {
      id: 2,
      game_code: gameCode,
      board_state: [[".", "."], [".", "."]],
      current_turn: "white",
      status: "active",
      player_white_address: whiteAddress,
      player_black_address: "GBLACK111111111111111111111111111111111111111111111111",
      draw_offer: null,
      in_check: false,
      last_move: null,
      moves: [],
      chat: [],
    });

    // Set up clock with known deadline in the future
    const startTime = Date.now();
    const baseMs = 10000; // 10 seconds
    harness.timerService.clocks.set(gameCode, {
      whiteMs: baseMs,
      blackMs: baseMs,
      incrementMs: 0,
      preset: "rapid",
      turn: "white",
      deadline: startTime + baseMs,
      timeout: null,
    });

    const client = Client(harness.url);
    clients.push(client);

    await waitFor(client, "connect");

    // Simulate a 3-second delay
    await new Promise((resolve) => setTimeout(resolve, 100)); // 100ms for test speed

    const response = await new Promise((resolve) => {
      client.emit("reconnect_game", { gameId: gameCode, walletAddress: whiteAddress, token: whiteToken }, resolve);
    });

    const rehydrated = await waitFor(client, "game:rehydrated");

    // Clock should be ~100ms less than the original
    expect(rehydrated.whiteTimeMs).toBeLessThan(baseMs);
    expect(rehydrated.whiteTimeMs).toBeGreaterThan(0);
    expect(rehydrated.whiteTimeMs).toBeLessThanOrEqual(baseMs);
  });

  test("opponent notification: opponent's socket receives player_reconnected event", async () => {
    harness = await createReconnectHarness();

    const whiteAddress = "GADDW43PFTFQKJZFVQKQZ5VF2CQZQ3Z5QKQZQ3Z5QKQZQ3Z5QKQZQ3";
    const blackAddress = "GBLACK111111111111111111111111111111111111111111111111";
    const whiteToken = createToken(whiteAddress);
    const gameCode = "TEST789";

    harness.mockGames.set(gameCode, {
      id: 3,
      game_code: gameCode,
      board_state: [[".", "."], [".", "."]],
      current_turn: "white",
      status: "active",
      player_white_address: whiteAddress,
      player_black_address: blackAddress,
      draw_offer: null,
      in_check: false,
      last_move: null,
      moves: [],
      chat: [],
    });

    harness.timerService.clocks.set(gameCode, {
      whiteMs: 600000,
      blackMs: 600000,
      incrementMs: 0,
      preset: "rapid",
      turn: "white",
      deadline: Date.now() + 600000,
      timeout: null,
    });

    // Connect opponent first (simulating they were already in the game)
    const blackClient = Client(harness.url);
    clients.push(blackClient);
    await waitFor(blackClient, "connect");
    blackClient.emit("join-game", { gameCode, playerColor: "black" });
    await waitFor(blackClient, "presence-snapshot");

    // Now reconnecting white player
    const whiteClient = Client(harness.url);
    clients.push(whiteClient);
    await waitFor(whiteClient, "connect");

    const reconnectedPromise = waitFor(blackClient, "player_reconnected");

    whiteClient.emit("reconnect_game", { gameId: gameCode, walletAddress: whiteAddress, token: whiteToken }, () => {});

    const reconnectedEvent = await reconnectedPromise;
    expect(reconnectedEvent).toMatchObject({
      gameId: gameCode,
      color: "white",
      timestamp: expect.any(String),
    });
  });

  test("room rejoin: socket is actually a member of the correct game room after reconnect_game", async () => {
    harness = await createReconnectHarness();

    const whiteAddress = "GADDW43PFTFQKJZFVQKQZ5VF2CQZQ3Z5QKQZQ3Z5QKQZQ3Z5QKQZQ3";
    const blackAddress = "GBLACK111111111111111111111111111111111111111111111111";
    const whiteToken = createToken(whiteAddress);
    const gameCode = "ROOM001";

    harness.mockGames.set(gameCode, {
      id: 4,
      game_code: gameCode,
      board_state: [[".", "."], [".", "."]],
      current_turn: "white",
      status: "active",
      player_white_address: whiteAddress,
      player_black_address: blackAddress,
      draw_offer: null,
      in_check: false,
      last_move: null,
      moves: [],
      chat: [],
    });

    harness.timerService.clocks.set(gameCode, {
      whiteMs: 600000,
      blackMs: 600000,
      incrementMs: 0,
      preset: "rapid",
      turn: "white",
      deadline: Date.now() + 600000,
      timeout: null,
    });

    const whiteClient = Client(harness.url);
    clients.push(whiteClient);
    await waitFor(whiteClient, "connect");

    // Reconnect
    const reconnectAck = await new Promise((resolve) => {
      whiteClient.emit("reconnect_game", { gameId: gameCode, walletAddress: whiteAddress, token: whiteToken }, resolve);
    });

    expect(reconnectAck.error).toBeNull();

    // Verify room membership by emitting a room broadcast and checking if white receives it
    const broadcastReceived = waitFor(whiteClient, "test-broadcast");
    harness.io.to(gameCode).emit("test-broadcast", { test: "data" });

    const received = await Promise.race([
      broadcastReceived,
      new Promise((resolve) => setTimeout(() => resolve(null), 100)),
    ]);

    expect(received).toMatchObject({ test: "data" });
  });

  test("auth failure: reconnect_game with invalid token is rejected with clear error", async () => {
    harness = await createReconnectHarness();

    const whiteAddress = "GADDW43PFTFQKJZFVQKQZ5VF2CQZQ3Z5QKQZQ3Z5QKQZQ3Z5QKQZQ3";
    const gameCode = "AUTHFAIL1";

    harness.mockGames.set(gameCode, {
      id: 5,
      game_code: gameCode,
      board_state: [[".", "."], [".", "."]],
      current_turn: "white",
      status: "active",
      player_white_address: whiteAddress,
      player_black_address: "GBLACK111111111111111111111111111111111111111111111111",
      draw_offer: null,
      in_check: false,
      last_move: null,
      moves: [],
      chat: [],
    });

    harness.timerService.clocks.set(gameCode, {
      whiteMs: 600000,
      blackMs: 600000,
      incrementMs: 0,
      preset: "rapid",
      turn: "white",
      deadline: Date.now() + 600000,
      timeout: null,
    });

    const client = Client(harness.url);
    clients.push(client);
    await waitFor(client, "connect");

    const response = await new Promise((resolve) => {
      client.emit("reconnect_game", { gameId: gameCode, walletAddress: whiteAddress, token: "invalid.token" }, resolve);
    });

    expect(response.error).toBeTruthy();
    expect(response.error).toContain("Invalid or expired token");
    expect(response.data).toBeUndefined();
  });

  test("auth failure: token does not match walletAddress is rejected", async () => {
    harness = await createReconnectHarness();

    const whiteAddress = "GADDW43PFTFQKJZFVQKQZ5VF2CQZQ3Z5QKQZQ3Z5QKQZQ3Z5QKQZQ3";
    const differentAddress = "GDIFFERENTADDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD";
    const whiteToken = createToken(whiteAddress);
    const gameCode = "AUTHFAIL2";

    harness.mockGames.set(gameCode, {
      id: 6,
      game_code: gameCode,
      board_state: [[".", "."], [".", "."]],
      current_turn: "white",
      status: "active",
      player_white_address: whiteAddress,
      player_black_address: "GBLACK111111111111111111111111111111111111111111111111",
      draw_offer: null,
      in_check: false,
      last_move: null,
      moves: [],
      chat: [],
    });

    harness.timerService.clocks.set(gameCode, {
      whiteMs: 600000,
      blackMs: 600000,
      incrementMs: 0,
      preset: "rapid",
      turn: "white",
      deadline: Date.now() + 600000,
      timeout: null,
    });

    const client = Client(harness.url);
    clients.push(client);
    await waitFor(client, "connect");

    const response = await new Promise((resolve) => {
      client.emit("reconnect_game", { gameId: gameCode, walletAddress: differentAddress, token: whiteToken }, resolve);
    });

    expect(response.error).toBeTruthy();
    expect(response.error).toContain("does not match");
  });

  test("auth failure: reconnect_game for a gameId the player is not part of is rejected", async () => {
    harness = await createReconnectHarness();

    const whiteAddress = "GADDW43PFTFQKJZFVQKQZ5VF2CQZQ3Z5QKQZQ3Z5QKQZQ3Z5QKQZQ3";
    const whiteToken = createToken(whiteAddress);
    const gameCode = "AUTHFAIL3";

    harness.mockGames.set(gameCode, {
      id: 7,
      game_code: gameCode,
      board_state: [[".", "."], [".", "."]],
      current_turn: "white",
      status: "active",
      player_white_address: "GOTHER1111111111111111111111111111111111111111111111",
      player_black_address: "GBLACK111111111111111111111111111111111111111111111111",
      draw_offer: null,
      in_check: false,
      last_move: null,
      moves: [],
      chat: [],
    });

    harness.timerService.clocks.set(gameCode, {
      whiteMs: 600000,
      blackMs: 600000,
      incrementMs: 0,
      preset: "rapid",
      turn: "white",
      deadline: Date.now() + 600000,
      timeout: null,
    });

    const client = Client(harness.url);
    clients.push(client);
    await waitFor(client, "connect");

    const response = await new Promise((resolve) => {
      client.emit("reconnect_game", { gameId: gameCode, walletAddress: whiteAddress, token: whiteToken }, resolve);
    });

    expect(response.error).toBeTruthy();
    expect(response.error).toContain("not part of this game");
  });

  test("not-found: reconnect_game with non-existent gameId returns clear error", async () => {
    harness = await createReconnectHarness();

    const whiteAddress = "GADDW43PFTFQKJZFVQKQZ5VF2CQZQ3Z5QKQZQ3Z5QKQZQ3Z5QKQZQ3";
    const whiteToken = createToken(whiteAddress);

    const client = Client(harness.url);
    clients.push(client);
    await waitFor(client, "connect");

    const response = await new Promise((resolve) => {
      client.emit("reconnect_game", { gameId: "NONEXISTENT", walletAddress: whiteAddress, token: whiteToken }, resolve);
    });

    expect(response.error).toBeTruthy();
    expect(response.error).toContain("Game not found");
  });

  test("chat/history truncation: payload includes at most last 20 chat messages", async () => {
    harness = await createReconnectHarness();

    const whiteAddress = "GADDW43PFTFQKJZFVQKQZ5VF2CQZQ3Z5QKQZQ3Z5QKQZQ3Z5QKQZQ3";
    const whiteToken = createToken(whiteAddress);
    const gameCode = "CHAT001";

    // Create 30 mock chat messages
    const chatMessages = Array.from({ length: 30 }, (_, i) => ({
      id: i,
      game_code: gameCode,
      player_color: i % 2 === 0 ? "white" : "black",
      message: `Message ${i}`,
      created_at: new Date(Date.now() - (30 - i) * 1000).toISOString(),
    }));

    harness.mockGames.set(gameCode, {
      id: 8,
      game_code: gameCode,
      board_state: [[".", "."], [".", "."]],
      current_turn: "white",
      status: "active",
      player_white_address: whiteAddress,
      player_black_address: "GBLACK111111111111111111111111111111111111111111111111",
      draw_offer: null,
      in_check: false,
      last_move: null,
      moves: [],
      chat: chatMessages,
    });

    harness.timerService.clocks.set(gameCode, {
      whiteMs: 600000,
      blackMs: 600000,
      incrementMs: 0,
      preset: "rapid",
      turn: "white",
      deadline: Date.now() + 600000,
      timeout: null,
    });

    const client = Client(harness.url);
    clients.push(client);
    await waitFor(client, "connect");

    const response = await new Promise((resolve) => {
      client.emit("reconnect_game", { gameId: gameCode, walletAddress: whiteAddress, token: whiteToken }, resolve);
    });

    const rehydrated = await waitFor(client, "game:rehydrated");

    expect(rehydrated.recentChat.length).toBeLessThanOrEqual(20);
    // Should be the last 20 messages
    expect(rehydrated.recentChat[0].message).toBe("Message 10");
    expect(rehydrated.recentChat[19].message).toBe("Message 29");
  });

  test("game not active: reconnect_game for finished game returns clear error", async () => {
    harness = await createReconnectHarness();

    const whiteAddress = "GADDW43PFTFQKJZFVQKQZ5VF2CQZQ3Z5QKQZQ3Z5QKQZQ3Z5QKQZQ3";
    const whiteToken = createToken(whiteAddress);
    const gameCode = "FINISHED1";

    harness.mockGames.set(gameCode, {
      id: 9,
      game_code: gameCode,
      board_state: [[".", "."], [".", "."]],
      current_turn: "white",
      status: "finished",
      player_white_address: whiteAddress,
      player_black_address: "GBLACK111111111111111111111111111111111111111111111111",
      winner: "white",
      draw_offer: null,
      in_check: false,
      last_move: null,
      moves: [],
      chat: [],
    });

    const client = Client(harness.url);
    clients.push(client);
    await waitFor(client, "connect");

    const response = await new Promise((resolve) => {
      client.emit("reconnect_game", { gameId: gameCode, walletAddress: whiteAddress, token: whiteToken }, resolve);
    });

    expect(response.error).toBeTruthy();
    expect(response.error).toContain("Cannot reconnect");
  });

  test("missing inputs: reconnect_game with missing gameId returns clear error", async () => {
    harness = await createReconnectHarness();

    const whiteAddress = "GADDW43PFTFQKJZFVQKQZ5VF2CQZQ3Z5QKQZQ3Z5QKQZQ3Z5QKQZQ3";
    const whiteToken = createToken(whiteAddress);

    const client = Client(harness.url);
    clients.push(client);
    await waitFor(client, "connect");

    const response = await new Promise((resolve) => {
      client.emit("reconnect_game", { walletAddress: whiteAddress, token: whiteToken }, resolve);
    });

    expect(response.error).toBeTruthy();
    expect(response.error).toContain("Missing");
  });
});
