require("dotenv").config();
const { validateEnv } = require("./config/envValidator");
validateEnv();

const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const gameRoutes = require("./routes/gameRoutes");
const escrowRoutes = require("./routes/escrowRoutes");
const authRoutes = require("./routes/authRoutes");
const botRoutes = require("./routes/botRoutes");
const healthRoutes = require("./routes/healthRoutes");
const puzzleRoutes = require("./routes/puzzleRoutes");
const timerService = require("./services/timerService");
const cronService = require("./services/cronService");
const supabase = require("./config/supabase");
const logger = require("./utils/logger");
const { errorHandler, installGlobalHandlers } = require("./middleware/errorHandler");
const { createSocketRateLimiter } = require("./middleware/socketRateLimiter");
const { moderateMessage } = require("./services/chatService");
const { csrfProtection } = require("./middleware/csrfMiddleware");
const swaggerUi = require("swagger-ui-express");
const swaggerDocument = require("./docs/swagger.json");

const app = express();
const server = http.createServer(app);

const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const corsOrigin = CORS_ORIGIN === "*" ? true : CORS_ORIGIN;

const io = new Server(server, {
  cors: {
    origin: corsOrigin,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  },
});

// Rate limit WebSocket handshake/connection attempts per IP to prevent
// connection-flooding DoS before a socket is ever allocated (Issue #244).
const socketHandshakeLimiter = createSocketRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
});
io.engine.use((req, res, next) => socketHandshakeLimiter(req, res, next));

const PORT = process.env.PORT || 3001;

// Apply structured logging middleware
app.use(logger.requestMiddleware());

app.use(
  cors({
    origin: corsOrigin,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    credentials: true,
  }),
);
app.use(express.json());
app.use(csrfProtection);

app.get("/api/csrf-token", (req, res) => {
  res.json({ success: true });
});

// Swagger API documentation (Issue #152)
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// Mount routes
app.use("/api", gameRoutes);
app.use("/api/escrow", escrowRoutes);
app.use("/api", authRoutes);
app.use("/api", botRoutes);
app.use("/api", healthRoutes);
app.use("/api/puzzles", puzzleRoutes);

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

  socket.on("spectator:reaction", ({ gameCode, emoji } = {}) => {
    const allowedEmojis = new Set(["🔥", "👏", "♟️", "🤯", "💀"]);
    if (!gameCode || !allowedEmojis.has(emoji)) return;

    const now = Date.now();
    const recentReactions = (socket.data.reactionTimestamps || []).filter(
      (timestamp) => now - timestamp < 1000,
    );
    if (recentReactions.length >= 2) return;
    socket.data.reactionTimestamps = [...recentReactions, now];

    io.to(gameCode).emit("spectator:reaction", {
      id: `${socket.id}-${now}`,
      emoji,
      xOffset: 10 + Math.floor(Math.random() * 80),
    });
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

  // Relay a rematch challenge to the opponent (Issue #254). No persisted
  // state — purely a transient notification between the two live sockets.
  socket.on("request-rematch", ({ gameCode, playerColor }) => {
    if (!gameCode || !["white", "black"].includes(playerColor)) return;
    socket.to(gameCode).emit("rematch-requested", { gameCode, playerColor });
  });

  socket.on("send-chat", async ({ gameCode, playerColor, message }) => {
    if (!gameCode || !playerColor || !message) return;
    if (!["white", "black"].includes(playerColor)) return;

    const moderation = moderateMessage(message);
    if (!moderation.accepted) return;

    const { data, error } = await supabase
      .from("chat_messages")
      .insert({
        game_code: gameCode,
        player_color: playerColor,
        message: moderation.message,
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
if (require.main === module) {
  cronService.start();
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Chesster backend running on port ${PORT}`);
  });
}

module.exports = { app, server };
