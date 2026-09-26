require("dotenv").config();
const { validateEnv } = require("./config/envValidator");
validateEnv();

const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const gameRoutes = require("./routes/gameRoutes");
const escrowRoutes = require("./routes/escrowRoutes");
const authRoutes = require("./routes/authRoutes");
const botRoutes = require("./routes/botRoutes");
const healthRoutes = require("./routes/healthRoutes");
const referralRoutes = require("./routes/referralRoutes");
const puzzleRoutes = require("./routes/puzzleRoutes");
const timerService = require("./services/timerService");
const cronService = require("./services/cronService");
const eventConsumer = require("./workers/eventConsumer");
const supabase = require("./config/supabase");
const logger = require("./utils/logger");
const { errorHandler, installGlobalHandlers } = require("./middleware/errorHandler");
const { moderateMessage, checkSlowMode } = require("./services/chatService");
const { JWT_SECRET } = require("./middleware/authMiddleware");
const { createSocketRateLimiter } = require("./middleware/socketRateLimiter");
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

const { createAdapter } = require('@socket.io/redis-adapter');
const { getPubSubClients } = require('./config/redis');

const { pubClient, subClient } = getPubSubClients();
if (pubClient && subClient) {
  io.adapter(createAdapter(pubClient, subClient));
  console.log('Socket.io Redis adapter connected');
}

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
app.use("/api/referrals", referralRoutes);
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
    } else {
      // Spectator: join the spectator_chat room, never the player game room
      socket.join(`spectator_chat:${gameCode}`);
      socket.data.isSpectator = true;
      socket.data.gameCode = gameCode;
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

  socket.on("disconnect", async () => {
    const { gameCode, playerColor } = socket.data || {};
    if (!gameCode || !playerColor) return;

    const presence = getPresenceEntry(gameCode);
    // Ignore stale disconnects from a socket that already got replaced by a
    // fresher reconnect (e.g. rapid refresh / duplicate tabs).
    if (presence[playerColor].socketId !== socket.id) return;

    try {
      const gameModel = require("./models/gameModel");
      const game = await gameModel.getGame(gameCode);
      if (!game || game.status !== "active") return;
    } catch (e) {
      return;
    }

    presence[playerColor].socketId = null;
    broadcastPresence(gameCode, playerColor, "reconnecting");
    io.to(gameCode).emit('player_status', { color: playerColor, status: 'disconnected', graceMs: 60 * 1000 });

    // Give the player a 60-second grace period to reconnect before the
    // match is auto-forfeited on their behalf (see timerService).
    timerService.startReconnectGrace(gameCode, playerColor);
  });

  socket.on("reconnect_game", async ({ gameId, walletAddress, token }, ack) => {
    // Provide a clear ack callback for error/success responses
    const sendAck = (error, data) => {
      if (typeof ack === "function") {
        ack({ error, data });
      }
    };

    try {
      // ── 1. Validate inputs ─────────────────────────────────────────
      if (!gameId || !walletAddress || !token) {
        return sendAck("Missing gameId, walletAddress, or token");
      }

      // ── 2. Verify JWT token ────────────────────────────────────────
      let decoded;
      try {
        decoded = jwt.verify(token, JWT_SECRET);
      } catch (err) {
        return sendAck("Invalid or expired token");
      }

      // Verify the token's address matches the provided walletAddress
      const tokenAddress = decoded.address || decoded.sub;
      if (tokenAddress !== walletAddress) {
        return sendAck("Token does not match wallet address");
      }

      // ── 3. Fetch game and verify player is part of it ──────────────
      const gameModel = require("./models/gameModel");
      let game;
      try {
        game = await gameModel.getGame(gameId);
      } catch (err) {
        return sendAck("Game not found");
      }

      if (!game) {
        return sendAck("Game not found");
      }

      // Verify the wallet is actually one of the two players
      const isWhitePlayer = game.player_white_address === walletAddress;
      const isBlackPlayer = game.player_black_address === walletAddress;

      if (!isWhitePlayer && !isBlackPlayer) {
        return sendAck("You are not part of this game");
      }

      const playerColor = isWhitePlayer ? "white" : "black";

      // Verify game is still active
      if (game.status !== "active") {
        return sendAck(`Cannot reconnect to ${game.status} game`);
      }

      // ── 4. Cancel the reconnect grace timer ────────────────────────
      timerService.cancelReconnectGrace(gameId, playerColor);

      // ── 5. Rejoin the socket to the game room ─────────────────────
      socket.join(gameId);
      socket.data.gameCode = gameId;
      socket.data.playerColor = playerColor;

      // Update presence
      const presence = getPresenceEntry(gameId);
      presence[playerColor].socketId = socket.id;
      broadcastPresence(gameId, playerColor, "online");

      // ── 6. Compute precise clocks ──────────────────────────────────
      const clocks = timerService.getPreciseClocks(gameId);
      if (!clocks) {
        return sendAck("Clock not initialized for this game");
      }

      // ── 7. Fetch recent chat messages (last 20) ────────────────────
      let chatMessages = [];
      try {
        const allMessages = await gameModel.getChatMessages(gameId);
        chatMessages = allMessages.slice(-20); // Last 20 messages
      } catch (err) {
        logger.warn("Failed to fetch chat messages on reconnect", { gameId, error: err.message });
        // Non-critical; proceed without chat history
      }

      // ── 8. Fetch full move history ─────────────────────────────────
      let moves = [];
      try {
        moves = await gameModel.getMoves(gameId);
      } catch (err) {
        logger.warn("Failed to fetch moves on reconnect", { gameId, error: err.message });
        // Non-critical; proceed without moves
      }

      // ── 9. Build atomic rehydration payload ────────────────────────
      const rehydratePayload = {
        gameId,
        fen: game.board_state, // FEN representation
        moveHistory: moves.map(m => ({
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
        recentChat: chatMessages.map(m => ({
          id: m.id,
          playerColor: m.player_color,
          message: m.message,
          createdAt: m.created_at,
        })),
        inCheck: game.in_check || false,
        lastMove: game.last_move || null,
      };

      // ── 10. Emit atomic game:rehydrated event ──────────────────────
      socket.emit("game:rehydrated", rehydratePayload);

      // ── 11. Notify opponent of reconnection ────────────────────────
      socket.to(gameId).emit("player_reconnected", {
        gameId,
        color: playerColor,
        timestamp: new Date().toISOString(),
      });
      socket.to(gameId).emit('player_status', { color: playerColor, status: 'reconnected' });

      // Confirm success via ack
      sendAck(null, { success: true, gameId, playerColor });

    } catch (err) {
      logger.error("reconnect_game handler error", { error: err.message, stack: err.stack });
      sendAck(err.message || "Reconnection failed");
    }
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

  /**
   * Spectator chat message handler (Issue #304).
   * 
   * Enforces 5-second per-IP slow-mode cooldown to prevent spectator chat floods
   * that could distract players or leak move suggestions. Messages are sanitized
   * using the same moderation filter as player chat for consistency.
   * 
   * Critical isolation: spectator messages are broadcast ONLY to the spectator_chat room,
   * never to the player game room. This ensures active players are shielded from
   * spectator chatter.
   */
  socket.on("spectator_message", ({ gameCode, message }) => {
    if (!gameCode || !message) return;

    // Extract IP from socket.io handshake (matches HTTP rate-limiter convention)
    const clientIp = socket.handshake.address || socket.ip || "unknown";

    // Check slow-mode cooldown (5 seconds per IP, per issue #304)
    const slowModeCheck = checkSlowMode(clientIp, 5000);
    if (!slowModeCheck.allowed) {
      return socket.emit("chat_error", {
        gameCode,
        message: `Slow mode active. Please wait ${slowModeCheck.nextAvailableIn}s before sending another message.`,
        error: "slow_mode_active",
        nextAvailableInSeconds: slowModeCheck.nextAvailableIn,
      });
    }

    // Sanitize message using the existing moderation filter
    const moderation = moderateMessage(message);
    if (!moderation.accepted) {
      return socket.emit("chat_error", {
        gameCode,
        message: "Message rejected by content filter",
        error: "content_filter_rejected",
      });
    }

    // Broadcast ONLY to spectator_chat room, never to player game room
    // This is the core isolation guarantee (Issue #304 acceptance criteria)
    io.to(`spectator_chat:${gameCode}`).emit("new_spectator_message", {
      gameCode,
      message: moderation.message,
      createdAt: new Date().toISOString(),
    });
  });
});

app.set("io", io);
timerService.init(io);
if (require.main === module) {
	eventConsumer.start().catch((error) => logger.error("Event consumer failed to start", { error: error.message }));
  cronService.start();
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Chesster backend running on port ${PORT}`);
  });
}

module.exports = { app, server };
