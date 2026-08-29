const express = require("express");
const request = require("supertest");

jest.mock("../models/gameModel", () => ({
  createGame: jest.fn(),
  joinGame: jest.fn(),
  getGame: jest.fn(),
  getPendingGames: jest.fn(),
  getGameHistory: jest.fn(),
  makeMove: jest.fn(),
  getMoves: jest.fn(),
  resignGame: jest.fn(),
}));

jest.mock("../services/timerService", () => ({
  getTimeControls: jest.fn(() => [{ preset: "rapid", seconds: 600 }]),
  startClock: jest.fn(() => ({ whiteMs: 600000, blackMs: 600000, turn: "white" })),
  getClockState: jest.fn(() => null),
  applyMove: jest.fn(() => ({ whiteMs: 595000, blackMs: 600000, turn: "black" })),
  clearTimer: jest.fn(),
  clearClock: jest.fn(),
}));

jest.mock("../services/escrowService", () => ({
  init: jest.fn(),
  getMatch: jest.fn(),
  createMatch: jest.fn(),
  joinMatch: jest.fn(),
  resolveMatch: jest.fn(),
  DRAW_ADDRESS: "GDRAW",
}));

const gameModel = require("../models/gameModel");
const timerService = require("../services/timerService");
const escrowService = require("../services/escrowService");
const gameRoutes = require("../routes/gameRoutes");
const escrowRoutes = require("../routes/escrowRoutes");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.set("io", { to: jest.fn(() => ({ emit: jest.fn() })) });
  app.use("/api", gameRoutes);
  app.use("/api/escrow", escrowRoutes);
  return app;
}

describe("game and escrow route integration", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  test("POST /api/games creates a game and returns 201", async () => {
    const game = { game_code: "ABCD12", status: "waiting", current_turn: "white" };
    gameModel.createGame.mockResolvedValue(game);

    const response = await request(app)
      .post("/api/games")
      .send({ gameType: "chess", wagerAmount: 25, playerWhiteAddress: "GWHITE" });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ success: true, data: game });
    expect(gameModel.createGame).toHaveBeenCalledWith(
      "chess",
      25,
      "GWHITE",
      600,
      null,
      null,
      0,
    );
  });

  test("POST /api/games/:gameCode/join emits an update when game becomes active", async () => {
    gameModel.joinGame.mockResolvedValue({
      game_code: "ABCD12",
      status: "active",
      current_turn: "white",
      time_control_seconds: 300,
      time_increment_seconds: 2,
    });

    const response = await request(app)
      .post("/api/games/ABCD12/join")
      .send({ playerColor: "black", playerAddress: "GBLACK" });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.clock).toEqual({ whiteMs: 600000, blackMs: 600000, turn: "white" });
    expect(timerService.startClock).toHaveBeenCalledWith("ABCD12", {
      preset: undefined,
      baseSeconds: 300,
      incrementSeconds: 2,
      turn: "white",
    });
  });

  test("GET /api/games/:gameCode returns 404 for missing games", async () => {
    gameModel.getGame.mockRejectedValue(new Error("Game not found"));

    const response = await request(app).get("/api/games/MISSING");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ success: false, error: "Game not found" });
  });

  test("POST /api/games/:gameCode/move returns validation errors without mutating clocks", async () => {
    gameModel.getGame.mockResolvedValue({ current_turn: "white" });
    gameModel.makeMove.mockRejectedValue(new Error("Illegal move"));

    const response = await request(app)
      .post("/api/games/ABCD12/move")
      .send({ from: [6, 4], to: [3, 4] });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Illegal move");
    expect(timerService.applyMove).not.toHaveBeenCalled();
  });

  test("GET /api/escrow/:gameCode returns on-chain escrow state", async () => {
    escrowService.getMatch.mockResolvedValue({ gameCode: "ABCD12", status: 1 });

    const response = await request(app).get("/api/escrow/ABCD12");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: { gameCode: "ABCD12", status: 1 } });
  });

  test("POST /api/escrow/create rejects missing required fields", async () => {
    const response = await request(app).post("/api/escrow/create").send({ gameCode: "ABCD12" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "missing required fields" });
    expect(escrowService.createMatch).not.toHaveBeenCalled();
  });

  test("POST /api/escrow/resolve maps draw to the contract draw address", async () => {
    escrowService.resolveMatch.mockResolvedValue({ hash: "tx1", blockNumber: 12 });

    const response = await request(app)
      .post("/api/escrow/resolve")
      .send({ gameCode: "ABCD12", winner: "draw" });

    expect(response.status).toBe(200);
    expect(escrowService.resolveMatch).toHaveBeenCalledWith("ABCD12", "GDRAW");
    expect(response.body).toMatchObject({ success: true, txHash: "tx1", blockNumber: 12 });
  });
});
