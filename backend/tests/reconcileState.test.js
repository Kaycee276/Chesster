const http = require("http");
const { Server } = require("socket.io");
const { io: Client } = require("socket.io-client");

const { handleReconnect, reconcileGameState } = require("../socket/moveAuthority");

function waitFor(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}

/**
 * Minimal harness exercising the real `handleReconnect` / `reconcileGameState`
 * exports from `socket/moveAuthority.js` behind a `reconcile_state` socket
 * event, the same way `server.js` wires them (Issue #434). `join-game` here
 * is a simplified stand-in for the real (already separately tested) handler:
 * it only needs to bind `socket.data` so `reconcile_state` has something to
 * authorize against.
 */
async function createReconcileHarness() {
  const httpServer = http.createServer();
  const io = new Server(httpServer, { cors: { origin: "*" } });

  const mockGames = new Map();
  const mockMoves = new Map();
  const mockClocks = new Map();

  const gameModel = {
    async getGame(gameCode) {
      const game = mockGames.get(gameCode);
      if (!game) throw new Error("Game not found");
      return game;
    },
  };

  const gameController = {
    async getGameStateSnapshot(gameCode) {
      const game = mockGames.get(gameCode);
      if (!game) return null;
      return { game, moves: mockMoves.get(gameCode) || [] };
    },
  };

  const cancelledGrace = [];
  const timerService = {
    cancelReconnectGrace(gameCode, color) {
      cancelledGrace.push(`${gameCode}:${color}`);
    },
    getPreciseClocks(gameCode) {
      return mockClocks.get(gameCode) || null;
    },
  };

  io.on("connection", (socket) => {
    socket.on("join-game", ({ gameCode, playerColor, address }) => {
      socket.join(gameCode);
      socket.data.gameCode = gameCode;
      socket.data.playerColor = playerColor;
      socket.data.address = address;
    });

    socket.on("reconcile_state", async ({ gameId, lastKnownMoveIndex }, ack) => {
      const sendAck = (error, data) => {
        if (typeof ack === "function") ack({ error, data });
      };

      const boundColor = socket.data.playerColor;
      if (!boundColor || socket.data.gameCode !== gameId || !socket.data.address) {
        return sendAck("not-a-player");
      }

      try {
        const reconnect = await handleReconnect({ gameModel, timerService }, gameId, socket.data.address);
        if (!reconnect.ok) {
          return sendAck(reconnect.message || "not-a-player");
        }

        const reconciled = await reconcileGameState(
          { gameController, timerService },
          gameId,
          lastKnownMoveIndex,
          reconnect.playerColor,
        );
        if (!reconciled) return sendAck("game-not-found");

        socket.emit("STATE_RECONCILED", reconciled);
        sendAck(null, { success: true });
      } catch (err) {
        sendAck(err.message || "Reconciliation failed");
      }
    });
  });

  await new Promise((resolve) => httpServer.listen(0, resolve));
  const port = httpServer.address().port;
  return {
    io,
    url: `http://127.0.0.1:${port}`,
    mockGames,
    mockMoves,
    mockClocks,
    cancelledGrace,
    close: async () => {
      io.close();
      await new Promise((resolve) => httpServer.close(resolve));
    },
  };
}

describe("socket.io reconcile_state handler (Issue #434)", () => {
  let harness;
  const clients = [];

  afterEach(async () => {
    for (const client of clients.splice(0)) {
      client.disconnect();
    }
    if (harness) await harness.close();
  });

  const WHITE = "GWHITE1111111111111111111111111111111111111111111111";
  const BLACK = "GBLACK1111111111111111111111111111111111111111111111";

  function seedGame(harness, gameCode, overrides = {}) {
    harness.mockGames.set(gameCode, {
      id: 1,
      game_code: gameCode,
      board_state: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      current_turn: "white",
      status: "active",
      player_white_address: WHITE,
      player_black_address: BLACK,
      draw_offer: null,
      in_check: false,
      last_move: null,
      ...overrides,
    });
  }

  test("disconnect during active turn then reconnect: missed moves and live clock arrive with zero desync", async () => {
    harness = await createReconcileHarness();
    const gameCode = "RECON1";
    seedGame(harness, gameCode);
    harness.mockMoves.set(gameCode, [
      { move_number: 0, from_position: "e2", to_position: "e4", piece: "p", promotion: null },
    ]);
    harness.mockClocks.set(gameCode, { whiteMs: 58000, blackMs: 60000, incrementMs: 0, preset: "rapid" });

    const client = Client(harness.url);
    clients.push(client);
    await waitFor(client, "connect");

    // Simulates the client having applied moveSeq 0 (createdPending) before a
    // drop; a second move (moveSeq 1) landed on the server while it was gone.
    client.emit("join-game", { gameCode, playerColor: "white", address: WHITE });
    harness.mockMoves.set(gameCode, [
      { move_number: 0, from_position: "e2", to_position: "e4", piece: "p", promotion: null },
      { move_number: 1, from_position: "e7", to_position: "e5", piece: "p", promotion: null },
    ]);

    const reconciledPromise = waitFor(client, "STATE_RECONCILED");
    const ack = await new Promise((resolve) => {
      client.emit("reconcile_state", { gameId: gameCode, lastKnownMoveIndex: 0 }, resolve);
    });

    expect(ack.error).toBeNull();
    expect(ack.data.success).toBe(true);
    expect(harness.cancelledGrace).toContain(`${gameCode}:white`);

    const reconciled = await reconciledPromise;
    expect(reconciled.missedMoves).toEqual([
      { moveSeq: 1, from: "e7", to: "e5", piece: "p", promotion: null },
    ]);
    expect(reconciled.lastMoveSeq).toBe(1);
    expect(reconciled.whiteTimeMs).toBe(58000);
    expect(reconciled.blackTimeMs).toBe(60000);
    expect(reconciled.currentTurn).toBe("white");
  });

  test("rejects reconcile_state from a socket that never authenticated via join-game", async () => {
    harness = await createReconcileHarness();
    const gameCode = "RECON2";
    seedGame(harness, gameCode);

    const client = Client(harness.url);
    clients.push(client);
    await waitFor(client, "connect");

    const ack = await new Promise((resolve) => {
      client.emit("reconcile_state", { gameId: gameCode, lastKnownMoveIndex: -1 }, resolve);
    });

    expect(ack.error).toBe("not-a-player");
    expect(ack.data).toBeUndefined();
  });

  test("rejects reconcile_state for a game the bound color is not part of", async () => {
    harness = await createReconcileHarness();
    const gameCode = "RECON3";
    seedGame(harness, gameCode);

    const client = Client(harness.url);
    clients.push(client);
    await waitFor(client, "connect");

    // Bound to a wallet that isn't actually a participant in the game.
    client.emit("join-game", { gameCode, playerColor: "white", address: "GIMPOSTOR11111111111111111111111111111111111111111111" });

    const ack = await new Promise((resolve) => {
      client.emit("reconcile_state", { gameId: gameCode, lastKnownMoveIndex: -1 }, resolve);
    });

    expect(ack.error).toBe("You are not part of this game");
  });

  test("rejects reconciliation once the game has finished", async () => {
    harness = await createReconcileHarness();
    const gameCode = "RECON4";
    seedGame(harness, gameCode, { status: "finished", winner: "white" });
    harness.mockMoves.set(gameCode, []);

    const client = Client(harness.url);
    clients.push(client);
    await waitFor(client, "connect");

    client.emit("join-game", { gameCode, playerColor: "white", address: WHITE });

    const ack = await new Promise((resolve) => {
      client.emit("reconcile_state", { gameId: gameCode, lastKnownMoveIndex: -1 }, resolve);
    });

    expect(ack.error).toContain("Cannot reconnect");
  });

  test("returns the full move list (no missed-move gaps) when the client has no prior history", async () => {
    harness = await createReconcileHarness();
    const gameCode = "RECON5";
    seedGame(harness, gameCode);
    harness.mockMoves.set(gameCode, [
      { move_number: 0, from_position: "e2", to_position: "e4", piece: "p", promotion: null },
      { move_number: 1, from_position: "e7", to_position: "e5", piece: "p", promotion: null },
      { move_number: 2, from_position: "g1", to_position: "f3", piece: "n", promotion: null },
    ]);
    harness.mockClocks.set(gameCode, { whiteMs: 60000, blackMs: 60000, incrementMs: 0, preset: "rapid" });

    const client = Client(harness.url);
    clients.push(client);
    await waitFor(client, "connect");
    client.emit("join-game", { gameCode, playerColor: "black", address: BLACK });

    const reconciledPromise = waitFor(client, "STATE_RECONCILED");
    await new Promise((resolve) => {
      client.emit("reconcile_state", { gameId: gameCode, lastKnownMoveIndex: -1 }, resolve);
    });

    const reconciled = await reconciledPromise;
    expect(reconciled.missedMoves).toHaveLength(3);
    expect(reconciled.lastMoveSeq).toBe(2);
  });
});
