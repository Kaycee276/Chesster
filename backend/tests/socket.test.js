const http = require("http");
const { Server } = require("socket.io");
const { io: Client } = require("socket.io-client");

function waitFor(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}

async function createSocketHarness() {
  const httpServer = http.createServer();
  const io = new Server(httpServer, { cors: { origin: "*" } });
  const presence = new Map();

  function entry(gameCode) {
    if (!presence.has(gameCode)) {
      presence.set(gameCode, {
        white: { socketId: null, status: "offline" },
        black: { socketId: null, status: "offline" },
      });
    }
    return presence.get(gameCode);
  }

  io.on("connection", (socket) => {
    socket.on("join-game", (payload) => {
      const gameCode = typeof payload === "string" ? payload : payload?.gameCode;
      const playerColor = typeof payload === "object" ? payload?.playerColor : null;
      if (!gameCode) return;

      socket.join(gameCode);
      if (["white", "black"].includes(playerColor)) {
        socket.data.gameCode = gameCode;
        socket.data.playerColor = playerColor;
        const roomPresence = entry(gameCode);
        roomPresence[playerColor].socketId = socket.id;
        roomPresence[playerColor].status = "online";
        io.to(gameCode).emit("presence-update", { gameCode, color: playerColor, status: "online" });
      }

      const roomPresence = entry(gameCode);
      socket.emit("presence-snapshot", {
        gameCode,
        white: roomPresence.white.status,
        black: roomPresence.black.status,
      });
    });

    socket.on("send-chat", ({ gameCode, playerColor, message }) => {
      if (!gameCode || !["white", "black"].includes(playerColor) || !message) return;
      const sanitized = String(message).replace(/<[^>]*>/g, "").replace(/[<>]/g, "").trim().slice(0, 50);
      if (!sanitized) return;
      io.to(gameCode).emit("chat-message", {
        id: "test-message",
        playerColor,
        message: sanitized,
        createdAt: new Date(0).toISOString(),
      });
    });
  });

  await new Promise((resolve) => httpServer.listen(0, resolve));
  const port = httpServer.address().port;
  return {
    io,
    url: `http://127.0.0.1:${port}`,
    close: async () => {
      io.close();
      await new Promise((resolve) => httpServer.close(resolve));
    },
  };
}

describe("socket.io game room concurrency", () => {
  let harness;
  const clients = [];

  afterEach(async () => {
    for (const client of clients.splice(0)) {
      client.disconnect();
    }
    if (harness) await harness.close();
  });

  test("broadcasts presence only to clients in the joined game room", async () => {
    harness = await createSocketHarness();
    const white = Client(harness.url);
    const spectator = Client(harness.url);
    const otherRoom = Client(harness.url);
    clients.push(white, spectator, otherRoom);

    await Promise.all([waitFor(white, "connect"), waitFor(spectator, "connect"), waitFor(otherRoom, "connect")]);
    const spectatorSnapshot = waitFor(spectator, "presence-snapshot");
    const otherRoomSnapshot = waitFor(otherRoom, "presence-snapshot");
    spectator.emit("join-game", "GAME1");
    otherRoom.emit("join-game", "GAME2");
    await Promise.all([spectatorSnapshot, otherRoomSnapshot]);

    const presenceSeen = waitFor(spectator, "presence-update");
    const leaked = new Promise((resolve) => otherRoom.once("presence-update", () => resolve(true)));
    white.emit("join-game", { gameCode: "GAME1", playerColor: "white" });

    await expect(presenceSeen).resolves.toMatchObject({
      gameCode: "GAME1",
      color: "white",
      status: "online",
    });
    await expect(Promise.race([leaked, new Promise((resolve) => setTimeout(() => resolve(false), 50))])).resolves.toBe(false);
  });

  test("delivers sanitized chat messages to concurrent clients in one room", async () => {
    harness = await createSocketHarness();
    const white = Client(harness.url);
    const black = Client(harness.url);
    clients.push(white, black);

    await Promise.all([waitFor(white, "connect"), waitFor(black, "connect")]);
    const whiteSnapshot = waitFor(white, "presence-snapshot");
    const blackSnapshot = waitFor(black, "presence-snapshot");
    white.emit("join-game", { gameCode: "GAME1", playerColor: "white" });
    black.emit("join-game", { gameCode: "GAME1", playerColor: "black" });
    await Promise.all([whiteSnapshot, blackSnapshot]);

    const messageForWhite = waitFor(white, "chat-message");
    const messageForBlack = waitFor(black, "chat-message");
    white.emit("send-chat", { gameCode: "GAME1", playerColor: "white", message: "<b>good move</b>" });

    await expect(Promise.all([messageForWhite, messageForBlack])).resolves.toEqual([
      expect.objectContaining({ playerColor: "white", message: "good move" }),
      expect.objectContaining({ playerColor: "white", message: "good move" }),
    ]);
  });
});
