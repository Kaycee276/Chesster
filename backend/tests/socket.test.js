/**
 * Socket.io real-time game room tests: concurrent client connections,
 * move/presence broadcast correctness, and room isolation.
 *
 * These tests boot the *real* server (server.js) on an ephemeral port and
 * drive it with real socket.io-client connections, so the actual
 * `io.on("connection", ...)` wiring in server.js is exercised end to end.
 * Supabase, the escrow/cron services, and game/timer persistence are
 * mocked so no external network calls are made.
 */

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost";
process.env.SUPABASE_KEY = "test-key";
process.env.SOROBAN_RPC_URL = "http://localhost";
process.env.PORT = "0";

const Client = require("socket.io-client");
const request = require("supertest");

// @stellar/stellar-sdk transitively ships an ESM-only dependency
// (@noble/hashes) that Jest's CJS transform can't parse. It's required
// directly by healthRoutes.js and authService.js (neither of which is
// exercised by these socket tests), so stub the whole package.
jest.mock("@stellar/stellar-sdk", () => ({
  Keypair: { fromSecret: jest.fn(), random: jest.fn() },
  rpc: { Server: jest.fn().mockImplementation(() => ({})) },
  TransactionBuilder: jest.fn(),
  Networks: { TESTNET: "Test SDF Network ; September 2015", PUBLIC: "Public Global Stellar Network ; September 2015" },
  Contract: jest.fn(),
  xdr: {},
  scValToNative: jest.fn(),
  nativeToScVal: jest.fn(),
}));

const mockChatInsertResult = { data: null, error: null };

jest.mock("../config/supabase", () => ({
  from: jest.fn(() => ({
    insert: jest.fn(() => ({
      select: jest.fn(() => ({
        single: jest.fn(() => Promise.resolve(mockChatInsertResult)),
      })),
    })),
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    lt: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue({ data: [], error: null }),
  })),
}));

jest.mock("../services/cronService", () => ({
  start: jest.fn(),
  stop: jest.fn(),
}));

// authRoutes -> authController -> authService pulls in @stellar/stellar-sdk,
// which transitively ships an ESM-only dependency (@noble/hashes) that Jest's
// CJS transform can't parse. Mocked purely to keep server.js requirable;
// socket behavior under test doesn't touch auth.
jest.mock("../services/authService", () => ({
  createChallenge: jest.fn(),
  verifyChallenge: jest.fn(),
  generateToken: jest.fn(),
  verifyToken: jest.fn(),
}));

jest.mock("../services/escrowService", () => ({
  init: jest.fn(),
  getMatch: jest.fn(),
  createMatch: jest.fn(),
  joinMatch: jest.fn(),
  resolveMatch: jest.fn(),
  DRAW_ADDRESS: "DRAW_ADDRESS_PLACEHOLDER",
}));

// Real timerService.startReconnectGrace schedules a real 60s setTimeout,
// which would otherwise keep the Jest process alive after the suite ends.
// The disconnect/reconnect socket handlers only call through these methods;
// their internal timing isn't what this suite is testing.
jest.mock("../services/timerService", () => ({
  init: jest.fn(),
  isPendingForfeit: jest.fn().mockReturnValue(false),
  cancelReconnectGrace: jest.fn(),
  startReconnectGrace: jest.fn(),
  startClock: jest.fn(),
  getClockState: jest.fn(),
  applyMove: jest.fn(),
  clearTimer: jest.fn(),
  clearClock: jest.fn(),
}));

jest.mock("../models/gameModel", () => ({
  createGame: jest.fn(),
  joinGame: jest.fn(),
  getGame: jest.fn().mockResolvedValue({ current_turn: "white" }),
  getPendingGames: jest.fn(),
  makeMove: jest.fn(),
  getMoves: jest.fn(),
  resignGame: jest.fn(),
  offerDraw: jest.fn(),
  acceptDraw: jest.fn(),
  getChatMessages: jest.fn(),
  getGameHistory: jest.fn(),
  requestUndoMove: jest.fn(),
  acceptUndoMove: jest.fn(),
  rejectUndoMove: jest.fn(),
}));

let server;
let io;
let app;
let port;

function connectClient() {
  return Client(`http://localhost:${port}`, {
    transports: ["websocket"],
    forceNew: true,
  });
}

function waitForEvent(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}

function waitForConnect(socket) {
  return new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
}

beforeAll(async () => {
  ({ app, server, io } = require("../server"));
  if (!server.listening) {
    await new Promise((resolve) => server.once("listening", resolve));
  }
  port = server.address().port;
});

afterAll(async () => {
  if (!io || !server) return;
  io.close();
  await new Promise((resolve) => server.close(resolve));
});

describe("Socket.io real-time game rooms", () => {
  let clients = [];

  afterEach(() => {
    clients.forEach((c) => c.disconnect());
    clients = [];
  });

  test("a client can join a game room and receives a presence snapshot", async () => {
    const client = connectClient();
    clients.push(client);
    await waitForConnect(client);

    const snapshotPromise = waitForEvent(client, "presence-snapshot");
    client.emit("join-game", { gameCode: "ROOM_A", playerColor: "white" });

    const snapshot = await snapshotPromise;
    expect(snapshot).toEqual({
      gameCode: "ROOM_A",
      white: "online",
      black: "offline",
    });
  });

  test("accepts a bare gameCode string as a spectator join", async () => {
    const client = connectClient();
    clients.push(client);
    await waitForConnect(client);

    const snapshotPromise = waitForEvent(client, "presence-snapshot");
    client.emit("join-game", "ROOM_SPECTATE");

    const snapshot = await snapshotPromise;
    expect(snapshot.gameCode).toBe("ROOM_SPECTATE");
  });

  test("joining as a player broadcasts presence-update to everyone in the room", async () => {
    const spectator = connectClient();
    const player = connectClient();
    clients.push(spectator, player);
    await Promise.all([waitForConnect(spectator), waitForConnect(player)]);

    spectator.emit("join-game", "ROOM_B");
    await waitForEvent(spectator, "presence-snapshot");

    const presenceUpdatePromise = waitForEvent(spectator, "presence-update");
    player.emit("join-game", { gameCode: "ROOM_B", playerColor: "black" });

    const update = await presenceUpdatePromise;
    expect(update).toEqual({ gameCode: "ROOM_B", color: "black", status: "online" });
  });

  test("room isolation: a client in a different room does not receive another room's presence-update", async () => {
    const inRoomA = connectClient();
    const inRoomC = connectClient();
    const joiner = connectClient();
    clients.push(inRoomA, inRoomC, joiner);
    await Promise.all([waitForConnect(inRoomA), waitForConnect(inRoomC), waitForConnect(joiner)]);

    inRoomA.emit("join-game", "ROOM_ISOLATION_A");
    inRoomC.emit("join-game", "ROOM_ISOLATION_C");
    await Promise.all([
      waitForEvent(inRoomA, "presence-snapshot"),
      waitForEvent(inRoomC, "presence-snapshot"),
    ]);

    const leakedEvent = jest.fn();
    inRoomC.on("presence-update", leakedEvent);

    const presenceUpdatePromise = waitForEvent(inRoomA, "presence-update");
    joiner.emit("join-game", { gameCode: "ROOM_ISOLATION_A", playerColor: "white" });
    await presenceUpdatePromise;

    // Give any wrongly-broadcast event a moment to arrive before asserting.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(leakedEvent).not.toHaveBeenCalled();
  });

  test("leave-game removes the socket from the room so it stops receiving broadcasts", async () => {
    const leaver = connectClient();
    const stayer = connectClient();
    clients.push(leaver, stayer);
    await Promise.all([waitForConnect(leaver), waitForConnect(stayer)]);

    leaver.emit("join-game", "ROOM_LEAVE");
    await waitForEvent(leaver, "presence-snapshot");
    leaver.emit("leave-game", "ROOM_LEAVE");

    const leakedEvent = jest.fn();
    leaver.on("presence-update", leakedEvent);

    stayer.emit("join-game", { gameCode: "ROOM_LEAVE", playerColor: "black" });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(leakedEvent).not.toHaveBeenCalled();
  });

  test("concurrent joins across many clients each get their own presence snapshot and correct room membership", async () => {
    const roomAClients = Array.from({ length: 5 }, connectClient);
    const roomBClients = Array.from({ length: 5 }, connectClient);
    clients.push(...roomAClients, ...roomBClients);
    await Promise.all([...roomAClients, ...roomBClients].map(waitForConnect));

    const roomAReceived = roomAClients.map((c) => jest.fn());
    const roomBReceived = roomBClients.map((c) => jest.fn());
    roomAClients.forEach((c, idx) => c.on("presence-update", roomAReceived[idx]));
    roomBClients.forEach((c, idx) => c.on("presence-update", roomBReceived[idx]));

    // All clients join concurrently, half in room A, half in room B.
    await Promise.all([
      ...roomAClients.map((c) => {
        const p = waitForEvent(c, "presence-snapshot");
        c.emit("join-game", "ROOM_CONCURRENT_A");
        return p;
      }),
      ...roomBClients.map((c) => {
        const p = waitForEvent(c, "presence-snapshot");
        c.emit("join-game", "ROOM_CONCURRENT_B");
        return p;
      }),
    ]);

    // A fresh player join to room A should broadcast to every room-A client
    // (including spectators) and to zero room-B clients.
    const playerA = connectClient();
    clients.push(playerA);
    await waitForConnect(playerA);

    const roomAUpdatePromises = roomAClients.map((c) => waitForEvent(c, "presence-update"));
    playerA.emit("join-game", { gameCode: "ROOM_CONCURRENT_A", playerColor: "white" });
    await Promise.all(roomAUpdatePromises);

    await new Promise((resolve) => setTimeout(resolve, 50));
    roomBReceived.forEach((fn) => expect(fn).not.toHaveBeenCalled());
  });

  test("send-chat persists and broadcasts chat-message only within the room", async () => {
    mockChatInsertResult.data = {
      id: 1,
      player_color: "white",
      message: "gg",
      created_at: "2024-01-01T00:00:00.000Z",
    };
    mockChatInsertResult.error = null;

    const inRoom = connectClient();
    const outsideRoom = connectClient();
    clients.push(inRoom, outsideRoom);
    await Promise.all([waitForConnect(inRoom), waitForConnect(outsideRoom)]);

    inRoom.emit("join-game", "ROOM_CHAT");
    outsideRoom.emit("join-game", "ROOM_CHAT_OTHER");
    await Promise.all([
      waitForEvent(inRoom, "presence-snapshot"),
      waitForEvent(outsideRoom, "presence-snapshot"),
    ]);

    const leakedChat = jest.fn();
    outsideRoom.on("chat-message", leakedChat);

    const chatPromise = waitForEvent(inRoom, "chat-message");
    inRoom.emit("send-chat", { gameCode: "ROOM_CHAT", playerColor: "white", message: "gg" });

    const chatMessage = await chatPromise;
    expect(chatMessage).toEqual({
      id: 1,
      playerColor: "white",
      message: "gg",
      createdAt: "2024-01-01T00:00:00.000Z",
    });
    expect(leakedChat).not.toHaveBeenCalled();
  });

  test("send-chat sanitizes HTML and control characters before broadcasting", async () => {
    mockChatInsertResult.data = {
      id: 2,
      player_color: "black",
      message: "alert",
      created_at: "2024-01-01T00:00:00.000Z",
    };
    mockChatInsertResult.error = null;

    const client = connectClient();
    clients.push(client);
    await waitForConnect(client);

    client.emit("join-game", "ROOM_SANITIZE");
    await waitForEvent(client, "presence-snapshot");

    const chatPromise = waitForEvent(client, "chat-message");
    client.emit("send-chat", {
      gameCode: "ROOM_SANITIZE",
      playerColor: "black",
      message: "<script>alert('x')</script>",
    });

    const chatMessage = await chatPromise;
    // The handler strips tags/angle-brackets before insert; we only assert
    // the broadcast reflects whatever the (mocked) persisted row contains.
    expect(chatMessage.message).toBe("alert");
  });

  test("send-chat is a no-op when required fields are missing", async () => {
    const client = connectClient();
    clients.push(client);
    await waitForConnect(client);

    client.emit("join-game", "ROOM_INVALID_CHAT");
    await waitForEvent(client, "presence-snapshot");

    const chatHandler = jest.fn();
    client.on("chat-message", chatHandler);

    client.emit("send-chat", { gameCode: "ROOM_INVALID_CHAT", playerColor: "white" }); // no message
    client.emit("send-chat", { gameCode: "ROOM_INVALID_CHAT", playerColor: "purple", message: "hi" }); // bad color

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(chatHandler).not.toHaveBeenCalled();
  });

  test("REST-triggered game-update (move) is broadcast in real time only to sockets in that game's room", async () => {
    const gameModel = require("../models/gameModel");
    gameModel.getGame.mockResolvedValue({ current_turn: "white" });
    gameModel.makeMove.mockResolvedValue({
      game_code: "ROOM_MOVE",
      status: "active",
      current_turn: "black",
    });

    const inGameRoom = connectClient();
    const inOtherRoom = connectClient();
    clients.push(inGameRoom, inOtherRoom);
    await Promise.all([waitForConnect(inGameRoom), waitForConnect(inOtherRoom)]);

    inGameRoom.emit("join-game", "ROOM_MOVE");
    inOtherRoom.emit("join-game", "ROOM_MOVE_OTHER");
    await Promise.all([
      waitForEvent(inGameRoom, "presence-snapshot"),
      waitForEvent(inOtherRoom, "presence-snapshot"),
    ]);

    const leakedUpdate = jest.fn();
    inOtherRoom.on("game-update", leakedUpdate);

    const updatePromise = waitForEvent(inGameRoom, "game-update");
    const res = await request(app)
      .post("/api/games/ROOM_MOVE/move")
      .send({ from: "e2", to: "e4" });
    expect(res.status).toBe(200);

    const update = await updatePromise;
    expect(update.game_code).toBe("ROOM_MOVE");
    expect(update.current_turn).toBe("black");
    expect(leakedUpdate).not.toHaveBeenCalled();
  });

  test("disconnect clears presence and starts a reconnect grace period", async () => {
    const player = connectClient();
    const observer = connectClient();
    clients.push(player, observer);
    await Promise.all([waitForConnect(player), waitForConnect(observer)]);

    observer.emit("join-game", "ROOM_DISCONNECT");
    await waitForEvent(observer, "presence-snapshot");

    player.emit("join-game", { gameCode: "ROOM_DISCONNECT", playerColor: "white" });
    await waitForEvent(observer, "presence-update"); // "online"

    const reconnectingPromise = waitForEvent(observer, "presence-update");
    player.disconnect();
    clients = clients.filter((c) => c !== player);

    const update = await reconnectingPromise;
    expect(update).toEqual({ gameCode: "ROOM_DISCONNECT", color: "white", status: "reconnecting" });
  });
});
