const express = require("express");
const request = require("supertest");

const mockBatchImportGames = jest.fn(async (games) => games.map((_, i) => ({ id: `id-${i}`, game_code: `CODE${i}` })));

jest.mock("../models/gameModel", () => ({
	batchImportGames: (...args) => mockBatchImportGames(...args),
}));
jest.mock("../services/timerService", () => ({}));

const gameRoutes = require("../routes/gameRoutes");

function buildApp() {
	const app = express();
	app.use(express.json());
	app.use("/api", gameRoutes);
	return app;
}

const SIMPLE_GAME = `[Event "Casual Game"]
[White "Alice"]
[Black "Bob"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 1-0
`;

const MALFORMED_GAME = `[Event "Broken"]
[White "A"]
[Black "B"]
[Result "*"]

1. e4 e5 2. Zz9 Nc6 *
`;

describe("POST /api/games/import-pgn", () => {
	let app;

	beforeEach(() => {
		mockBatchImportGames.mockClear();
		app = buildApp();
	});

	it("rejects an empty body with 400", async () => {
		const res = await request(app).post("/api/games/import-pgn").set("Content-Type", "text/plain").send("");
		expect(res.status).toBe(400);
		expect(res.body.success).toBe(false);
	});

	it("imports a valid game and persists it via gameModel.batchImportGames", async () => {
		const res = await request(app)
			.post("/api/games/import-pgn")
			.set("Content-Type", "text/plain")
			.send(SIMPLE_GAME);

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.data.imported).toBe(1);
		expect(res.body.data.skipped).toBe(0);
		expect(mockBatchImportGames).toHaveBeenCalledTimes(1);
	});

	it("skips a malformed game and reports it without persisting it", async () => {
		const res = await request(app)
			.post("/api/games/import-pgn")
			.set("Content-Type", "text/plain")
			.send(MALFORMED_GAME);

		expect(res.status).toBe(200);
		expect(res.body.data.imported).toBe(0);
		expect(res.body.data.skipped).toBe(1);
		expect(res.body.data.games[0].valid).toBe(false);
		expect(mockBatchImportGames).not.toHaveBeenCalled();
	});

	it("imports a multi-game archive mixing valid and invalid games", async () => {
		const archive = `${SIMPLE_GAME}\n${MALFORMED_GAME}`;
		const res = await request(app)
			.post("/api/games/import-pgn")
			.set("Content-Type", "text/plain")
			.send(archive);

		expect(res.status).toBe(200);
		expect(res.body.data.total).toBe(2);
		expect(res.body.data.imported).toBe(1);
		expect(res.body.data.skipped).toBe(1);
	});
});
