const express = require("express");
const request = require("supertest");

jest.mock("../services/botService", () => ({ getBestMove: jest.fn() }));
jest.mock("../models/gameModel", () => ({ getGame: jest.fn(), makeMove: jest.fn() }));

const botService = require("../services/botService");
const gameModel = require("../models/gameModel");
const botRoutes = require("../routes/botRoutes");

function buildApp() {
	const app = express();
	app.use(express.json());
	app.set("io", { to: jest.fn(() => ({ emit: jest.fn() })) });
	app.use("/api", botRoutes);
	return app;
}

function codedError(message, code) {
	return Object.assign(new Error(message), { code });
}

describe("bot routes worker-pool error handling", () => {
	const board = [["."]];

	beforeEach(() => jest.clearAllMocks());

	it("returns the move computed by the bot service", async () => {
		const move = { from: [6, 4], to: [4, 4], promotion: null, uci: "e2e4", engine: "stockfish" };
		botService.getBestMove.mockResolvedValue(move);

		const res = await request(buildApp()).post("/api/bot/move").send({ board, turn: "white", difficulty: "master" });

		expect(res.status).toBe(200);
		expect(res.body.data).toEqual(move);
		expect(botService.getBestMove).toHaveBeenCalledWith(board, "white", null, "master", 0);
	});

	it("maps a bot move timeout to 504", async () => {
		botService.getBestMove.mockRejectedValue(codedError("Bot move exceeded 3000ms", "BOT_TIMEOUT"));

		const res = await request(buildApp()).post("/api/bot/move").send({ board, turn: "white" });

		expect(res.status).toBe(504);
		expect(res.body).toEqual({ success: false, error: "Bot move exceeded 3000ms" });
	});

	it("maps a saturated worker queue to 503", async () => {
		botService.getBestMove.mockRejectedValue(codedError("Bot engine is busy", "BOT_QUEUE_FULL"));

		const res = await request(buildApp()).post("/api/bot/move").send({ board, turn: "white" });

		expect(res.status).toBe(503);
	});

	it("maps pool errors on the stateful bot-move route and does not apply a move", async () => {
		gameModel.getGame.mockResolvedValue({ status: "active", board_state: board, current_turn: "black", move_count: 3 });
		botService.getBestMove.mockRejectedValue(codedError("Bot move exceeded 3000ms", "BOT_TIMEOUT"));

		const res = await request(buildApp()).post("/api/games/ABC123/bot-move").send({ difficulty: "beginner" });

		expect(res.status).toBe(504);
		expect(gameModel.makeMove).not.toHaveBeenCalled();
	});

	it("keeps 400 for ordinary errors on the stateful route", async () => {
		gameModel.getGame.mockResolvedValue({ status: "active", board_state: board, current_turn: "black", move_count: 3 });
		botService.getBestMove.mockResolvedValue({ from: [1, 4], to: [3, 4], promotion: null });
		gameModel.makeMove.mockRejectedValue(new Error("Invalid move"));

		const res = await request(buildApp()).post("/api/games/ABC123/bot-move").send({});

		expect(res.status).toBe(400);
	});
});
