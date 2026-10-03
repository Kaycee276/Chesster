const { z } = require("zod");

/**
 * Socket.io Payload Schemas (Issue #324)
 * Strict validation with length caps, type enforcement, and injection prevention.
 */

// SAN / UCI move payload
const MakeMoveSchema = z.object({
  gameId: z.string().min(1).max(100).optional(),
  gameCode: z.string().min(1).max(100).optional(),
  move: z.string().min(2).max(10).optional(),
  from: z.string().min(2).max(5).optional(),
  to: z.string().min(2).max(5).optional(),
  promotion: z.enum(["q", "r", "b", "n", "Q", "R", "B", "N"]).optional().nullable(),
  playerColor: z.enum(["white", "black"]).optional(),
}).refine((data) => data.gameId || data.gameCode, {
  message: "Either gameId or gameCode must be provided",
}).refine((data) => data.move || (data.from && data.to), {
  message: "Either move string or from/to coordinates must be provided",
});

// Chat message payload with 500-character cap
const SendChatSchema = z.object({
  gameCode: z.string().min(1).max(100).optional(),
  gameId: z.string().min(1).max(100).optional(),
  playerColor: z.enum(["white", "black"]),
  message: z.string().min(1).max(500),
}).refine((data) => data.gameCode || data.gameId, {
  message: "Either gameCode or gameId must be provided",
});

const ChatPayload = z.object({
  gameId: z.string().min(1).max(100).optional(),
  gameCode: z.string().min(1).max(100).optional(),
  message: z.string().min(1).max(500),
  sender: z.string().max(100).optional(),
  timestamp: z.union([z.number(), z.string()]).optional(),
});

// Spectator message payload with 500-character cap
const SpectatorMessageSchema = z.object({
  gameCode: z.string().min(1).max(100),
  message: z.string().min(1).max(500),
});

// Spectator reaction payload
const SpectatorReactionSchema = z.object({
  gameCode: z.string().min(1).max(100),
  emoji: z.string().min(1).max(10),
});

// Draw offer payload
const DrawOfferPayload = z.object({
  gameId: z.string().min(1).max(100).optional(),
  gameCode: z.string().min(1).max(100).optional(),
  action: z.enum(["offer", "accept", "decline", "cancel"]).optional(),
  playerColor: z.enum(["white", "black"]).optional(),
});

// Join room payload
const JoinRoomPayload = z.union([
  z.string().min(1).max(100),
  z.object({
    gameCode: z.string().min(1).max(100).optional(),
    gameId: z.string().min(1).max(100).optional(),
    playerColor: z.enum(["white", "black"]).optional().nullable(),
    walletAddress: z.string().max(100).optional(),
    token: z.string().max(1000).optional(),
  }),
]);

// Reconnect game payload
const ReconnectGameSchema = z.object({
  gameId: z.string().min(1).max(100),
  walletAddress: z.string().min(1).max(100),
  token: z.string().min(1).max(2000),
});

// Rematch request payload
const RequestRematchSchema = z.object({
  gameCode: z.string().min(1).max(100),
  playerColor: z.enum(["white", "black"]),
});

// Leave game payload
const LeaveGameSchema = z.union([
  z.string().min(1).max(100),
  z.object({
    gameCode: z.string().min(1).max(100).optional(),
    gameId: z.string().min(1).max(100).optional(),
  }),
]);

/**
 * Validates a socket event with a given Zod schema.
 * Rejects invalid payloads without throwing unhandled exceptions,
 * and emits both 'event_error' and 'error:validation' events.
 */
function handleSocketEvent(socket, schema, data, callback) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const errorPayload = {
      error: "Validation failed",
      errors: result.error.errors,
      issues: result.error.issues,
    };
    if (socket && typeof socket.emit === "function") {
      socket.emit("event_error", errorPayload);
      socket.emit("error:validation", errorPayload);
    }
    return false;
  }
  if (typeof callback === "function") {
    callback(result.data);
  }
  return true;
}

/**
 * Higher-order function decorator for Socket.io event listeners.
 */
function validateSocketPayload(schema, handler) {
  return function (payload, ack) {
    const socket = this;
    const result = schema.safeParse(payload);
    if (!result.success) {
      const errorPayload = {
        error: "Validation failed",
        errors: result.error.errors,
        issues: result.error.issues,
      };
      if (typeof ack === "function") {
        ack({ error: "Validation failed", details: result.error.errors });
      }
      if (socket && typeof socket.emit === "function") {
        socket.emit("event_error", errorPayload);
        socket.emit("error:validation", errorPayload);
      }
      return;
    }
    return handler.call(socket, result.data, ack);
  };
}

module.exports = {
  MakeMoveSchema,
  ChatPayload,
  SendChatSchema,
  SpectatorMessageSchema,
  SpectatorReactionSchema,
  DrawOfferPayload,
  JoinRoomPayload,
  ReconnectGameSchema,
  RequestRematchSchema,
  LeaveGameSchema,
  handleSocketEvent,
  validateSocketPayload,
};
