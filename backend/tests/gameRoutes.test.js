/**
 * Supertest integration tests for /api/games and /api/escrow endpoints.
 */

const request = require("supertest");
const express = require("express");

jest.mock("../models/gameModel", () => ({
  createGame: jest.fn(),
  joinGame: jest.fn(),
  getGame: jest.fn(),
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

jest.mock("../services/timerService", () => ({
  getTimeControls: jest.fn(),
  startClock: jest.fn(),
  getClockState: jest.fn(),
  applyMove: jest.fn(),
  clearTimer: jest.fn(),
  clearClock: jest.fn(),
}));

jest.mock("../services/escrowService", () => ({
  init: jest.fn(),
  getMatch: jest.fn(),
  createMatch: jest.fn(),
  joinMatch: jest.fn(),
  resolveMatch: jest.fn(),
  DRAW_ADDRESS: "DRAW_ADDRESS_PLACEHOLDER",
}));

const gameModel = require("../models/gameModel");
const timerService = require("../services/timerService");
const escrowService = require("../services/escrowService");
const gameRoutes = require("../routes/gameRoutes");
const escrowRoutes = require("../routes/escrowRoutes");

function buildApp() {
  const app = express();
  app.use(express.json());

  const mockIo = { to: jest.fn().mockReturnThis(), emit: jest.fn() };
  app.set("io", mockIo);

  app.use("/api", gameRoutes);
  app.use("/api/escrow", escrowRoutes);
  return { app, mockIo };
}

describe("Game & Escrow Routes", () => {
  let app;
  let mockIo;

  beforeEach(() => {
    jest.clearAllMocks();
    ({ app, mockIo } = buildApp());
  });

  // ---------------------------------------------------------------------
  // POST /api/games
  // ---------------------------------------------------------------------
  describe("POST /api/games", () => {
    test("creates a game and returns 201 with the created game", async () => {
      const created = { id: 1, game_code: "ABC123", status: "waiting" };
      gameModel.createGame.mockResolvedValue(created);

      const res = await request(app)
        .post("/api/games")
        .send({ gameType: "wagered", wagerAmount: 100, playerWhiteAddress: "P1" });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ success: true, data: created });
      expect(gameModel.createGame).toHaveBeenCalledWith(
        "wagered",
        100,
        "P1",
        600,
        null,
        null,
        0,
      );
    });

    test("applies defaults for optional fields", async () => {
      gameModel.createGame.mockResolvedValue({ id: 2 });

      await request(app).post("/api/games").send({});

      expect(gameModel.createGame).toHaveBeenCalledWith(
        undefined,
        undefined,
        undefined,
        600,
        null,
        null,
        0,
      );
    });

    test("returns 500 when game creation fails", async () => {
      gameModel.createGame.mockRejectedValue(new Error("db unavailable"));

      const res = await request(app).post("/api/games").send({});

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ success: false, error: "db unavailable" });
    });
  });

  // ---------------------------------------------------------------------
  // GET /api/time-controls
  // ---------------------------------------------------------------------
  describe("GET /api/time-controls", () => {
    test("returns the supported time control presets", async () => {
      const presets = { blitz: 300, rapid: 600 };
      timerService.getTimeControls.mockReturnValue(presets);

      const res = await request(app).get("/api/time-controls");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: presets });
    });
  });

  // ---------------------------------------------------------------------
  // GET /api/games/pending
  // ---------------------------------------------------------------------
  describe("GET /api/games/pending", () => {
    test("returns pending games", async () => {
      gameModel.getPendingGames.mockResolvedValue([{ game_code: "P1" }]);

      const res = await request(app).get("/api/games/pending");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: [{ game_code: "P1" }] });
    });

    test("returns 500 when the model throws", async () => {
      gameModel.getPendingGames.mockRejectedValue(new Error("boom"));

      const res = await request(app).get("/api/games/pending");

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });

  // ---------------------------------------------------------------------
  // GET /api/games (history)
  // ---------------------------------------------------------------------
  describe("GET /api/games", () => {
    test("passes query filters through and returns history", async () => {
      gameModel.getGameHistory.mockResolvedValue({ data: [], total: 0 });

      const res = await request(app)
        .get("/api/games")
        .query({ playerAddress: "P1", status: "completed", page: "2", pageSize: "10" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: [], total: 0 });
      expect(gameModel.getGameHistory).toHaveBeenCalledWith({
        playerAddress: "P1",
        status: "completed",
        dateFrom: null,
        dateTo: null,
        page: "2",
        pageSize: "10",
        sortBy: "created_at",
        sortOrder: "desc",
      });
    });

    test("uses defaults when no query params are given", async () => {
      gameModel.getGameHistory.mockResolvedValue({ data: [], total: 0 });

      await request(app).get("/api/games");

      expect(gameModel.getGameHistory).toHaveBeenCalledWith({
        playerAddress: null,
        status: null,
        dateFrom: null,
        dateTo: null,
        page: 1,
        pageSize: 20,
        sortBy: "created_at",
        sortOrder: "desc",
      });
    });

    test("returns 500 on failure", async () => {
      gameModel.getGameHistory.mockRejectedValue(new Error("query failed"));

      const res = await request(app).get("/api/games");

      expect(res.status).toBe(500);
    });
  });

  // ---------------------------------------------------------------------
  // POST /api/games/:gameCode/join
  // ---------------------------------------------------------------------
  describe("POST /api/games/:gameCode/join", () => {
    test("joins an active game, starts the clock, and broadcasts an update", async () => {
      const game = {
        game_code: "ABC123",
        status: "active",
        time_control_preset: "blitz",
        time_control_seconds: 300,
        time_increment_seconds: 0,
        current_turn: "white",
      };
      gameModel.joinGame.mockResolvedValue(game);
      timerService.startClock.mockReturnValue({ white: 300000, black: 300000 });

      const res = await request(app)
        .post("/api/games/ABC123/join")
        .send({ playerColor: "black", playerAddress: "P2" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.clock).toEqual({ white: 300000, black: 300000 });
      expect(timerService.startClock).toHaveBeenCalledWith("ABC123", {
        preset: "blitz",
        baseSeconds: 300,
        incrementSeconds: 0,
        turn: "white",
      });
      expect(mockIo.to).toHaveBeenCalledWith("ABC123");
      expect(mockIo.emit).toHaveBeenCalledWith(
        "game-update",
        expect.objectContaining({ game_code: "ABC123" }),
      );
    });

    test("does not start a clock for a non-active game", async () => {
      gameModel.joinGame.mockResolvedValue({ game_code: "ABC123", status: "waiting" });

      const res = await request(app)
        .post("/api/games/ABC123/join")
        .send({ playerColor: "black", playerAddress: "P2" });

      expect(res.status).toBe(200);
      expect(res.body.data.clock).toBeNull();
      expect(timerService.startClock).not.toHaveBeenCalled();
    });

    test("returns 400 when the game code does not exist", async () => {
      gameModel.joinGame.mockRejectedValue(new Error("Game not found"));

      const res = await request(app)
        .post("/api/games/DOESNOTEXIST/join")
        .send({ playerColor: "black", playerAddress: "P2" });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ success: false, error: "Game not found" });
    });

    test("returns 400 when the game is already full", async () => {
      gameModel.joinGame.mockRejectedValue(new Error("Game already has two players"));

      const res = await request(app)
        .post("/api/games/ABC123/join")
        .send({ playerColor: "black", playerAddress: "P2" });

      expect(res.status).toBe(400);
    });
  });

  // ---------------------------------------------------------------------
  // GET /api/games/:gameCode
  // ---------------------------------------------------------------------
  describe("GET /api/games/:gameCode", () => {
    test("returns the game merged with clock state", async () => {
      gameModel.getGame.mockResolvedValue({ game_code: "ABC123", status: "active" });
      timerService.getClockState.mockReturnValue({ white: 100000, black: 90000 });

      const res = await request(app).get("/api/games/ABC123");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        data: { game_code: "ABC123", status: "active", clock: { white: 100000, black: 90000 } },
      });
    });

    test("returns 404 for an unknown game code", async () => {
      gameModel.getGame.mockRejectedValue(new Error("Game not found"));

      const res = await request(app).get("/api/games/NOPE");

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ success: false, error: "Game not found" });
    });
  });

  // ---------------------------------------------------------------------
  // POST /api/games/:gameCode/move
  // ---------------------------------------------------------------------
  describe("POST /api/games/:gameCode/move", () => {
    test("applies a move, advances the clock, and broadcasts the update", async () => {
      gameModel.getGame.mockResolvedValue({ current_turn: "white" });
      gameModel.makeMove.mockResolvedValue({ game_code: "ABC123", status: "active", current_turn: "black" });
      timerService.applyMove.mockReturnValue({ white: 295000, black: 300000 });

      const res = await request(app)
        .post("/api/games/ABC123/move")
        .send({ from: "e2", to: "e4" });

      expect(res.status).toBe(200);
      expect(res.body.data.clock).toEqual({ white: 295000, black: 300000 });
      expect(timerService.applyMove).toHaveBeenCalledWith("ABC123", "white");
      expect(mockIo.to).toHaveBeenCalledWith("ABC123");
      expect(mockIo.emit).toHaveBeenCalledWith("game-update", expect.any(Object));
    });

    test("clears timers when a move ends the game", async () => {
      gameModel.getGame.mockResolvedValue({ current_turn: "white" });
      gameModel.makeMove.mockResolvedValue({ game_code: "ABC123", status: "checkmate" });

      const res = await request(app)
        .post("/api/games/ABC123/move")
        .send({ from: "e2", to: "e4" });

      expect(res.status).toBe(200);
      expect(res.body.data.clock).toBeNull();
      expect(timerService.clearTimer).toHaveBeenCalledWith("ABC123");
      expect(timerService.clearClock).toHaveBeenCalledWith("ABC123");
      expect(timerService.applyMove).not.toHaveBeenCalled();
    });

    test("returns 400 for an illegal move", async () => {
      gameModel.getGame.mockResolvedValue({ current_turn: "white" });
      gameModel.makeMove.mockRejectedValue(new Error("Illegal move"));

      const res = await request(app)
        .post("/api/games/ABC123/move")
        .send({ from: "e2", to: "e5" });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ success: false, error: "Illegal move" });
    });

    test("returns 400 when the game lookup itself fails", async () => {
      gameModel.getGame.mockRejectedValue(new Error("Game not found"));

      const res = await request(app)
        .post("/api/games/NOPE/move")
        .send({ from: "e2", to: "e4" });

      expect(res.status).toBe(400);
    });
  });

  // ---------------------------------------------------------------------
  // GET /api/games/:gameCode/moves
  // ---------------------------------------------------------------------
  describe("GET /api/games/:gameCode/moves", () => {
    test("returns the move list", async () => {
      gameModel.getMoves.mockResolvedValue([{ from: "e2", to: "e4" }]);

      const res = await request(app).get("/api/games/ABC123/moves");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: [{ from: "e2", to: "e4" }] });
    });

    test("returns 404 when the game does not exist", async () => {
      gameModel.getMoves.mockRejectedValue(new Error("Game not found"));

      const res = await request(app).get("/api/games/NOPE/moves");

      expect(res.status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------
  // POST /api/games/:gameCode/resign
  // ---------------------------------------------------------------------
  describe("POST /api/games/:gameCode/resign", () => {
    test("resigns the game, clears timers, and broadcasts an update", async () => {
      const game = { game_code: "ABC123", status: "resigned" };
      gameModel.resignGame.mockResolvedValue(game);

      const res = await request(app)
        .post("/api/games/ABC123/resign")
        .send({ playerColor: "white" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: game });
      expect(timerService.clearTimer).toHaveBeenCalledWith("ABC123");
      expect(timerService.clearClock).toHaveBeenCalledWith("ABC123");
      expect(mockIo.emit).toHaveBeenCalledWith("game-update", game);
    });

    test("returns 400 when the game cannot be resigned", async () => {
      gameModel.resignGame.mockRejectedValue(new Error("Game already finished"));

      const res = await request(app)
        .post("/api/games/ABC123/resign")
        .send({ playerColor: "white" });

      expect(res.status).toBe(400);
    });
  });

  // ---------------------------------------------------------------------
  // Draw offer / accept
  // ---------------------------------------------------------------------
  describe("POST /api/games/:gameCode/draw/offer", () => {
    test("records a draw offer and broadcasts it", async () => {
      const game = { game_code: "ABC123", draw_offered_by: "white" };
      gameModel.offerDraw.mockResolvedValue(game);

      const res = await request(app)
        .post("/api/games/ABC123/draw/offer")
        .send({ playerColor: "white" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: game });
    });

    test("returns 400 when a draw offer is invalid", async () => {
      gameModel.offerDraw.mockRejectedValue(new Error("Game not active"));

      const res = await request(app)
        .post("/api/games/ABC123/draw/offer")
        .send({ playerColor: "white" });

      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/games/:gameCode/draw/accept", () => {
    test("accepts the draw, clears timers, and broadcasts it", async () => {
      const game = { game_code: "ABC123", status: "draw" };
      gameModel.acceptDraw.mockResolvedValue(game);

      const res = await request(app).post("/api/games/ABC123/draw/accept").send({});

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: game });
      expect(timerService.clearTimer).toHaveBeenCalledWith("ABC123");
      expect(timerService.clearClock).toHaveBeenCalledWith("ABC123");
    });

    test("returns 400 when there is no pending draw offer", async () => {
      gameModel.acceptDraw.mockRejectedValue(new Error("No draw offer pending"));

      const res = await request(app).post("/api/games/ABC123/draw/accept").send({});

      expect(res.status).toBe(400);
    });
  });

  // ---------------------------------------------------------------------
  // Undo request / accept / reject
  // ---------------------------------------------------------------------
  describe("Undo move flow", () => {
    test("POST /undo/request broadcasts the request", async () => {
      const game = { game_code: "ABC123", undo_requested_by: "white" };
      gameModel.requestUndoMove.mockResolvedValue(game);

      const res = await request(app)
        .post("/api/games/ABC123/undo/request")
        .send({ playerColor: "white" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: game });
    });

    test("POST /undo/request returns 400 when nothing to undo", async () => {
      gameModel.requestUndoMove.mockRejectedValue(new Error("No moves to undo"));

      const res = await request(app)
        .post("/api/games/ABC123/undo/request")
        .send({ playerColor: "white" });

      expect(res.status).toBe(400);
    });

    test("POST /undo/accept broadcasts the accepted undo", async () => {
      const game = { game_code: "ABC123" };
      gameModel.acceptUndoMove.mockResolvedValue(game);

      const res = await request(app)
        .post("/api/games/ABC123/undo/accept")
        .send({ playerColor: "black" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: game });
    });

    test("POST /undo/reject broadcasts the rejection", async () => {
      const game = { game_code: "ABC123", undo_requested_by: null };
      gameModel.rejectUndoMove.mockResolvedValue(game);

      const res = await request(app).post("/api/games/ABC123/undo/reject").send({});

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: game });
    });

    test("POST /undo/reject returns 400 on failure", async () => {
      gameModel.rejectUndoMove.mockRejectedValue(new Error("No undo request pending"));

      const res = await request(app).post("/api/games/ABC123/undo/reject").send({});

      expect(res.status).toBe(400);
    });
  });

  // ---------------------------------------------------------------------
  // GET /api/games/:gameCode/chat
  // ---------------------------------------------------------------------
  describe("GET /api/games/:gameCode/chat", () => {
    test("returns chat messages", async () => {
      gameModel.getChatMessages.mockResolvedValue([{ message: "gg" }]);

      const res = await request(app).get("/api/games/ABC123/chat");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: [{ message: "gg" }] });
    });

    test("returns 404 when the game does not exist", async () => {
      gameModel.getChatMessages.mockRejectedValue(new Error("Game not found"));

      const res = await request(app).get("/api/games/NOPE/chat");

      expect(res.status).toBe(404);
    });
  });

  // =======================================================================
  // /api/escrow
  // =======================================================================
  describe("GET /api/escrow/info", () => {
    test("returns ok with the configured contract address", async () => {
      const res = await request(app).get("/api/escrow/info");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        ok: true,
        contract: process.env.ESCROW_CONTRACT_ADDRESS || null,
      });
    });
  });

  describe("GET /api/escrow/:gameCode", () => {
    test("returns match details from the contract", async () => {
      escrowService.getMatch.mockResolvedValue({ status: "active", wager: 100 });

      const res = await request(app).get("/api/escrow/ABC123");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: { status: "active", wager: 100 } });
      expect(escrowService.getMatch).toHaveBeenCalledWith("ABC123");
    });

    test("returns 500 when the contract call fails", async () => {
      escrowService.getMatch.mockRejectedValue(new Error("RPC unavailable"));

      const res = await request(app).get("/api/escrow/ABC123");

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ success: false, error: "RPC unavailable" });
    });
  });

  describe("POST /api/escrow/create", () => {
    test("creates the on-chain match and returns the tx receipt", async () => {
      escrowService.createMatch.mockResolvedValue({ hash: "0xTX", blockNumber: 42 });

      const res = await request(app)
        .post("/api/escrow/create")
        .send({ gameCode: "ABC123", tokenAddress: "TOKEN1", wagerAmount: 100 });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, txHash: "0xTX", blockNumber: 42 });
      expect(escrowService.createMatch).toHaveBeenCalledWith("ABC123", "TOKEN1", 100);
    });

    test.each([
      [{ tokenAddress: "TOKEN1", wagerAmount: 100 }],
      [{ gameCode: "ABC123", wagerAmount: 100 }],
      [{ gameCode: "ABC123", tokenAddress: "TOKEN1" }],
    ])("returns 400 when a required field is missing (%#)", async (body) => {
      const res = await request(app).post("/api/escrow/create").send(body);

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "missing required fields" });
      expect(escrowService.createMatch).not.toHaveBeenCalled();
    });

    test("returns 500 when the on-chain call fails", async () => {
      escrowService.createMatch.mockRejectedValue(new Error("contract reverted"));

      const res = await request(app)
        .post("/api/escrow/create")
        .send({ gameCode: "ABC123", tokenAddress: "TOKEN1", wagerAmount: 100 });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ success: false, error: "contract reverted" });
    });
  });

  describe("POST /api/escrow/join", () => {
    test("joins the on-chain match and returns the tx receipt", async () => {
      escrowService.joinMatch.mockResolvedValue({ hash: "0xTX2", blockNumber: 43 });

      const res = await request(app).post("/api/escrow/join").send({ gameCode: "ABC123" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, txHash: "0xTX2", blockNumber: 43 });
      expect(escrowService.joinMatch).toHaveBeenCalledWith("ABC123");
    });

    test("returns 400 when gameCode is missing", async () => {
      const res = await request(app).post("/api/escrow/join").send({});

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "gameCode required" });
      expect(escrowService.joinMatch).not.toHaveBeenCalled();
    });

    test("returns 500 when the on-chain call fails", async () => {
      escrowService.joinMatch.mockRejectedValue(new Error("insufficient funds"));

      const res = await request(app).post("/api/escrow/join").send({ gameCode: "ABC123" });

      expect(res.status).toBe(500);
    });
  });

  describe("POST /api/escrow/resolve", () => {
    test("resolves the match with a winner address", async () => {
      escrowService.resolveMatch.mockResolvedValue({ hash: "0xTX3", blockNumber: 44 });

      const res = await request(app)
        .post("/api/escrow/resolve")
        .send({ gameCode: "ABC123", winner: "PLAYER1" });

      expect(res.status).toBe(200);
      expect(escrowService.resolveMatch).toHaveBeenCalledWith("ABC123", "PLAYER1");
    });

    test.each(["draw", null, ""])(
      "resolves as a draw when winner is %p",
      async (winner) => {
        escrowService.resolveMatch.mockResolvedValue({ hash: "0xTX4", blockNumber: 45 });

        const res = await request(app)
          .post("/api/escrow/resolve")
          .send({ gameCode: "ABC123", winner });

        expect(res.status).toBe(200);
        expect(escrowService.resolveMatch).toHaveBeenCalledWith(
          "ABC123",
          escrowService.DRAW_ADDRESS,
        );
      },
    );

    test("returns 400 when gameCode is missing", async () => {
      const res = await request(app).post("/api/escrow/resolve").send({ winner: "PLAYER1" });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "gameCode required" });
      expect(escrowService.resolveMatch).not.toHaveBeenCalled();
    });

    test("returns 500 when the on-chain resolve fails", async () => {
      escrowService.resolveMatch.mockRejectedValue(new Error("already resolved"));

      const res = await request(app)
        .post("/api/escrow/resolve")
        .send({ gameCode: "ABC123", winner: "PLAYER1" });

      expect(res.status).toBe(500);
    });
  });
});
