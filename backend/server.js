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
const timerService = require("./services/timerService");
const cronService = require("./services/cronService");
const supabase = require("./config/supabase");
const logger = require("./utils/logger");
const { errorHandler, installGlobalHandlers } = require("./middleware/errorHandler");
const { moderateMessage } = require("./services/chatService");
const gameModel = require("./models/gameModel");
const {
  verifySocketToken,
  resolvePlayerColor,
  authorizeMove,
} = require("./socket/moveAuthority");

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
  socket.on("join-game", async (payload) => {
    const gameCode = typeof payload === "string" ? payload : payload?.gameCode;
    const requestedColor = typeof payload === "object" ? payload?.playerColor : null;
    const token = typeof payload === "object" ? payload?.token : null;
    if (!gameCode) return;

    socket.join(gameCode);

    if (requestedColor && ["white", "black"].includes(requestedColor)) {
      // Server authority: a socket may only be bound to a player color if a
      // valid JWT proves it owns the wallet registered for that color in this
      // game. Without proof the connection is treated as a spectator, so a
      // spectator or attacker cannot impersonate a player over the socket.
      let boundColor = null;
      const claims = verifySocketToken(token);
      if (claims) {
        try {
          const game = await gameModel.getGame(gameCode);
          boundColor = resolvePlayerColor(game, claims.address);
        } catch (err) {
          boundColor = null;
        }
      }

      if (boundColor === requestedColor) {
        socket.data.gameCode = gameCode;
        socket.data.playerColor = boundColor;
        socket.data.address = claims.address;

        const presence = getPresenceEntry(gameCode);
        const wasReconnecting = timerService.isPendingForfeit(gameCode, boundColor);

        // A same-color reconnect within the grace period cancels the pending
        // auto-forfeit and resumes the game/session normally.
        timerService.cancelReconnectGrace(gameCode, boundColor);

        presence[boundColor].socketId = socket.id;
        broadcastPresence(gameCode, boundColor, "online");

        if (wasReconnecting) {
          socket.to(gameCode).emit("player-reconnected", { gameCode, color: boundColor });
        }
      } else {
        // Requested a color the caller cannot prove ownership of: stay a
        // spectator and let the client know the color binding was refused.
        socket.emit("auth-error", { gameCode, reason: "color-authentication-failed" });
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

  // Server-authoritative move channel. The move is applied only when the socket
  // was bound to a player color via an authenticated join and it is that
  // player's turn in an active game; otherwise it is rejected without touching
  // game state. This blocks socket injection and client-side move spoofing.
  socket.on("make-move", async ({ gameCode, from, to, promotion } = {}) => {
    if (!gameCode) return;

    const boundColor = socket.data.playerColor;
    if (!boundColor || socket.data.gameCode !== gameCode) {
      socket.emit("move-rejected", { gameCode, reason: "not-a-player" });
      return;
    }

    try {
      const game = await gameModel.getGame(gameCode);
      const gate = authorizeMove(game, boundColor);
      if (!gate.ok) {
        socket.emit("move-rejected", { gameCode, reason: gate.code, message: gate.message });
        return;
      }

      const moverColor = game.current_turn;
      const updated = await gameModel.makeMove(gameCode, from, to, promotion);

      let clock = null;
      if (updated.status === "active") {
        clock = timerService.applyMove(gameCode, moverColor);
      } else {
        timerService.clearTimer(gameCode);
        timerService.clearClock(gameCode);
      }

      io.to(gameCode).emit("game-update", { ...updated, clock });
    } catch (err) {
      socket.emit("move-rejected", { gameCode, reason: "invalid-move", message: err.message });
    }
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
cronService.start();

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Chesster backend running on port ${PORT}`);
});
