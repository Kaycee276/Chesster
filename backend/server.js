require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const gameRoutes = require("./routes/gameRoutes");
const escrowRoutes = require("./routes/escrowRoutes");
const authRoutes = require("./routes/authRoutes");
const botRoutes = require("./routes/botRoutes");
const healthRoutes = require("./routes/healthRoutes");
const timerService = require("./services/timerService");
const cronService = require("./services/cronService");
const supabase = require("./config/supabase");
const logger = require("./utils/logger");
const { errorHandler, installGlobalHandlers } = require("./middleware/errorHandler");
const { geoBlock } = require("./middleware/geoBlock");

const app = express();
const server = http.createServer(app);

const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

const io = new Server(server, {
  cors: {
    origin: CORS_ORIGIN,
    methods: ["GET", "POST"],
  },
});

const PORT = process.env.PORT || 3001;

// Apply structured logging middleware
app.use(logger.requestMiddleware());

app.use(
  cors({
    origin: CORS_ORIGIN,
    methods: ["GET", "POST"],
  }),
);
app.use(express.json());
app.use(geoBlock);

// Mount routes
app.use("/api", gameRoutes);
app.use("/api/escrow", escrowRoutes);
app.use("/api", authRoutes);
app.use("/api", botRoutes);
app.use("/api", healthRoutes);

// Legacy health endpoint
app.get("/health", (req, res) => {
  logger.info("Legacy health endpoint called");
  res.json({ status: "ok", message: "Chesster backend running" });
});

// Global error handler (must be registered after all routes)
app.use(errorHandler);

// Install global process handlers for unhandled rejections / uncaught exceptions
installGlobalHandlers();

// Tracks which color (if any) each connected socket represents, so we know
// what to do on disconnect: gameCode -> { white: { socketId, status }, black: { socketId, status } }
const gamePresence = new Map();

function getPresenceEntry(gameCode) {
  if (!gamePresence.has(gameCode)) {
    gamePresence.set(gameCode, {
      white: { socketId: null, status: "offline" },
      black: { socketId: null, status: "offline" },
    });
  }
  return gamePresence.get(gameCode);
}

function broadcastPresence(gameCode, color, status) {
  const presence = getPresenceEntry(gameCode);
  presence[color].status = status;
  io.to(gameCode).emit("presence-update", { gameCode, color, status });
}

io.on("connection", (socket) => {
  // Accepts either a bare gameCode string (spectator join) or
  // { gameCode, playerColor } so we can track presence / handle reconnects.
  socket.on("join-game", (payload) => {
    const gameCode = typeof payload === "string" ? payload : payload?.gameCode;
    const playerColor = typeof payload === "object" ? payload?.playerColor : null;
    if (!gameCode) return;

    socket.join(gameCode);

    if (playerColor && ["white", "black"].includes(playerColor)) {
      socket.data.gameCode = gameCode;
      socket.data.playerColor = playerColor;

      const presence = getPresenceEntry(gameCode);
      const wasReconnecting = timerService.isPendingForfeit(gameCode, playerColor);

      // A same-color reconnect within the grace period cancels the pending
      // auto-forfeit and resumes the game/session normally.
      timerService.cancelReconnectGrace(gameCode, playerColor);

      presence[playerColor].socketId = socket.id;
      broadcastPresence(gameCode, playerColor, "online");

      if (wasReconnecting) {
        socket.to(gameCode).emit("player-reconnected", { gameCode, color: playerColor });
      }
    }

    // Let everyone in the room (including the joiner) know the current
    // presence snapshot so newly-joining spectators see accurate badges.
    const presence = getPresenceEntry(gameCode);
    socket.emit("presence-snapshot", {
      gameCode,
      white: presence.white.status,
      black: presence.black.status,
    });
  });

  socket.on("leave-game", (gameCode) => {
    socket.leave(gameCode);
  });

  socket.on("disconnect", () => {
    const { gameCode, playerColor } = socket.data || {};
    if (!gameCode || !playerColor) return;

    const presence = getPresenceEntry(gameCode);
    // Ignore stale disconnects from a socket that already got replaced by a
    // fresher reconnect (e.g. rapid refresh / duplicate tabs).
    if (presence[playerColor].socketId !== socket.id) return;

    presence[playerColor].socketId = null;
    broadcastPresence(gameCode, playerColor, "reconnecting");

    // Give the player a 60-second grace period to reconnect before the
    // match is auto-forfeited on their behalf (see timerService).
    timerService.startReconnectGrace(gameCode, playerColor);
  });

  socket.on("send-chat", async ({ gameCode, playerColor, message }) => {
    if (!gameCode || !playerColor || !message) return;
    if (!["white", "black"].includes(playerColor)) return;

    // Sanitize: strip HTML tags, control chars, limit to 50 chars
    const sanitized = String(message)
      .replace(/<[^>]*>/g, "")
      .replace(/[<>]/g, "")
      .trim()
      .slice(0, 50);
    if (!sanitized) return;

    const { data, error } = await supabase
      .from("chat_messages")
      .insert({
        game_code: gameCode,
        player_color: playerColor,
        message: sanitized,
      })
      .select()
      .single();

    if (!error && data) {
      io.to(gameCode).emit("chat-message", {
        id: data.id,
        playerColor: data.player_color,
        message: data.message,
        createdAt: data.created_at,
      });
    }
  });
});

app.set("io", io);
timerService.init(io);
cronService.start();

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Chesster backend running on port ${PORT}`);
});
