const {
  MakeMoveSchema,
  ChatPayload,
  SendChatSchema,
  SpectatorMessageSchema,
  SpectatorReactionSchema,
  JoinRoomPayload,
  ReconnectGameSchema,
  RequestRematchSchema,
  validateSocketPayload,
  handleSocketEvent,
} = require("../validators/socketSchemas");

describe("WebSocket Message Payload Validation with Zod (Issue #324)", () => {
  describe("MakeMoveSchema", () => {
    test("validates valid SAN and coordinate move payloads", () => {
      const validSAN = { gameId: "g-123", move: "e4" };
      const validCoords = { gameCode: "g-123", from: "e2", to: "e4", promotion: "q" };

      expect(MakeMoveSchema.safeParse(validSAN).success).toBe(true);
      expect(MakeMoveSchema.safeParse(validCoords).success).toBe(true);
    });

    test("rejects moves that exceed string length caps (e.g. >10 chars)", () => {
      const oversizedSAN = {
        gameId: "g-123",
        move: "e4e5e6e7e8e9e10extra",
      };
      const result = MakeMoveSchema.safeParse(oversizedSAN);
      expect(result.success).toBe(false);
    });

    test("rejects malformed types (e.g. nested objects or null)", () => {
      const malformed = {
        gameId: "g-123",
        move: { $ne: "e4" }, // NoSQL/prototype injection attempt
      };
      const result = MakeMoveSchema.safeParse(malformed);
      expect(result.success).toBe(false);
    });
  });

  describe("SendChatSchema", () => {
    test("accepts valid chat messages within 500 characters", () => {
      const valid = {
        gameCode: "g-123",
        playerColor: "white",
        message: "Good game!",
      };
      expect(SendChatSchema.safeParse(valid).success).toBe(true);
    });

    test("rejects chat messages exceeding 500 character limit", () => {
      const longMessage = "A".repeat(501);
      const invalid = {
        gameCode: "g-123",
        playerColor: "white",
        message: longMessage,
      };
      const result = SendChatSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    test("rejects invalid playerColor values", () => {
      const invalidColor = {
        gameCode: "g-123",
        playerColor: "admin",
        message: "hello",
      };
      expect(SendChatSchema.safeParse(invalidColor).success).toBe(false);
    });
  });

  describe("SpectatorReactionSchema & SpectatorMessageSchema", () => {
    test("validates spectator message within 500 chars", () => {
      expect(
        SpectatorMessageSchema.safeParse({
          gameCode: "g-123",
          message: "What a great match!",
        }).success
      ).toBe(true);

      expect(
        SpectatorMessageSchema.safeParse({
          gameCode: "g-123",
          message: "x".repeat(501),
        }).success
      ).toBe(false);
    });

    test("validates spectator reaction", () => {
      expect(
        SpectatorReactionSchema.safeParse({
          gameCode: "g-123",
          emoji: "🔥",
        }).success
      ).toBe(true);
    });
  });

  describe("ReconnectGameSchema & RequestRematchSchema", () => {
    test("validates reconnect payload with required fields", () => {
      const valid = {
        gameId: "g-123",
        walletAddress: "GADDW43PFTFQKJZFVQKQZ5VF2CQZQ3Z5QKQZQ3Z5QKQZQ3Z5QKQZQ3",
        token: "jwt.token.string",
      };
      expect(ReconnectGameSchema.safeParse(valid).success).toBe(true);

      const missingToken = {
        gameId: "g-123",
        walletAddress: "GADDW43PFTFQKJZFVQKQZ5VF2CQZQ3Z5QKQZQ3Z5QKQZQ3Z5QKQZQ3",
      };
      expect(ReconnectGameSchema.safeParse(missingToken).success).toBe(false);
    });

    test("validates request-rematch payload", () => {
      expect(
        RequestRematchSchema.safeParse({
          gameCode: "g-123",
          playerColor: "white",
        }).success
      ).toBe(true);

      expect(
        RequestRematchSchema.safeParse({
          gameCode: "g-123",
          playerColor: "spectator",
        }).success
      ).toBe(false);
    });
  });

  describe("validateSocketPayload & handleSocketEvent decorators", () => {
    test("validateSocketPayload calls handler on valid payload", () => {
      const handler = jest.fn();
      const socket = { emit: jest.fn() };

      const wrapped = validateSocketPayload(SpectatorMessageSchema, handler);
      wrapped.call(socket, { gameCode: "g-123", message: "Hi" });

      expect(handler).toHaveBeenCalledWith({ gameCode: "g-123", message: "Hi" }, undefined);
      expect(socket.emit).not.toHaveBeenCalled();
    });

    test("validateSocketPayload emits error:validation on malformed payload without throwing", () => {
      const handler = jest.fn();
      const socket = { emit: jest.fn() };
      const ack = jest.fn();

      const wrapped = validateSocketPayload(SpectatorMessageSchema, handler);
      expect(() => {
        wrapped.call(socket, { gameCode: "g-123", message: 12345 }, ack);
      }).not.toThrow();

      expect(handler).not.toHaveBeenCalled();
      expect(socket.emit).toHaveBeenCalledWith("error:validation", expect.any(Object));
      expect(socket.emit).toHaveBeenCalledWith("event_error", expect.any(Object));
      expect(ack).toHaveBeenCalledWith(expect.objectContaining({ error: "Validation failed" }));
    });

    test("handleSocketEvent returns true on valid data and false on invalid", () => {
      const socket = { emit: jest.fn() };
      const callback = jest.fn();

      const validResult = handleSocketEvent(
        socket,
        SpectatorReactionSchema,
        { gameCode: "g-123", emoji: "👏" },
        callback
      );
      expect(validResult).toBe(true);
      expect(callback).toHaveBeenCalledWith({ gameCode: "g-123", emoji: "👏" });

      const invalidResult = handleSocketEvent(
        socket,
        SpectatorReactionSchema,
        { gameCode: 123 },
        callback
      );
      expect(invalidResult).toBe(false);
      expect(socket.emit).toHaveBeenCalledWith("error:validation", expect.any(Object));
    });
  });
});
