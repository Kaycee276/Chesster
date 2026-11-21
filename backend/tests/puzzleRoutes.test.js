process.env.JWT_SECRET = "puzzle-test-secret";

const express = require("express");
const jwt = require("jsonwebtoken");
const request = require("supertest");

jest.mock("../models/puzzleModel", () => ({
	getDailyPuzzle: jest.fn(),
  getAdaptivePuzzle: jest.fn(),
	getById: jest.fn(),
}));
jest.mock("../models/userModel", () => ({
	recordPuzzleSolve: jest.fn(),
}));

const puzzleModel = require("../models/puzzleModel");
const userModel = require("../models/userModel");
const puzzleRoutes = require("../routes/puzzleRoutes");

function buildApp() {
	const app = express();
	app.use(express.json());
	app.use("/api/puzzles", puzzleRoutes);
	return app;
}

describe("puzzle routes", () => {
	const dailyPuzzle = {
		id: "11111111-1111-4111-8111-111111111111",
		fen: "test fen",
		side_to_move: "white",
		rating: 900,
		date: "2026-09-25",
		solution_moves: ["e1e8"],
	};

	beforeEach(() => jest.clearAllMocks());

	test("GET /daily returns puzzle metadata without its solution", async () => {
		puzzleModel.getDailyPuzzle.mockResolvedValue({
			id: "11111111-1111-4111-8111-111111111111",
			fen: "test fen",
			side_to_move: "white",
			rating: 900,
			date: "2026-09-25",
			solution_moves: ["e1e8"],
		});

		const response = await request(buildApp()).get("/api/puzzles/daily");

		expect(response.status).toBe(200);
		expect(response.body.data).toMatchObject({
			fen: "test fen",
			sideToMove: "white",
			rating: 900,
		});
		expect(response.body.data.solution_moves).toBeUndefined();
	});

	test("GET /daily sets ETag and Cache-Control headers", async () => {
		puzzleModel.getDailyPuzzle.mockResolvedValue(dailyPuzzle);
		const response = await request(buildApp()).get("/api/puzzles/daily");
		expect(response.status).toBe(200);
		expect(response.headers["cache-control"]).toBe("public, max-age=300, stale-while-revalidate=60");
		expect(response.headers.etag).toMatch(/^"[0-9a-f]{32}"$/);
	});

	test("GET /daily returns 304 with empty body for a matching If-None-Match", async () => {
		puzzleModel.getDailyPuzzle.mockResolvedValue(dailyPuzzle);
		const first = await request(buildApp()).get("/api/puzzles/daily");
		const second = await request(buildApp())
			.get("/api/puzzles/daily")
			.set("If-None-Match", first.headers.etag);
		expect(second.status).toBe(304);
		expect(second.text).toBe("");
		expect(second.headers.etag).toBe(first.headers.etag);
		expect(second.headers["cache-control"]).toContain("max-age=300");
	});

	test("GET /daily accepts weak and list validators", async () => {
		puzzleModel.getDailyPuzzle.mockResolvedValue(dailyPuzzle);
		const { headers } = await request(buildApp()).get("/api/puzzles/daily");
		const weak = await request(buildApp()).get("/api/puzzles/daily").set("If-None-Match", `W/${headers.etag}`);
		const list = await request(buildApp())
			.get("/api/puzzles/daily")
			.set("If-None-Match", `"stale", ${headers.etag}`);
		expect(weak.status).toBe(304);
		expect(list.status).toBe(304);
	});

	test("GET /daily returns 200 with new data for a stale ETag", async () => {
		puzzleModel.getDailyPuzzle.mockResolvedValue(dailyPuzzle);
		const first = await request(buildApp()).get("/api/puzzles/daily");
		puzzleModel.getDailyPuzzle.mockResolvedValue({ ...dailyPuzzle, id: "22222222-2222-4222-8222-222222222222", date: "2026-09-26" });
		const second = await request(buildApp())
			.get("/api/puzzles/daily")
			.set("If-None-Match", first.headers.etag);
		expect(second.status).toBe(200);
		expect(second.body.data.id).toBe("22222222-2222-4222-8222-222222222222");
		expect(second.headers.etag).not.toBe(first.headers.etag);
	});

	test("GET /daily does not cache a 404", async () => {
		puzzleModel.getDailyPuzzle.mockResolvedValue(null);
		const response = await request(buildApp()).get("/api/puzzles/daily");
		expect(response.status).toBe(404);
		expect(response.headers["cache-control"]).toBeUndefined();
	});

  test("GET /adaptive returns a rated playable line with promotion colors", async () => {
    puzzleModel.getAdaptivePuzzle.mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111",
      fen: "test fen", side_to_move: "black", rating: 1520, solution_moves: ["a2a1q", "h7h8n"] });
    const response = await request(buildApp()).get("/api/puzzles/adaptive?targetRating=1500&range=100");
    expect(response.status).toBe(200);
    expect(puzzleModel.getAdaptivePuzzle).toHaveBeenCalledWith(1500, 100, undefined);
    expect(response.body.data).toMatchObject({ rating: 1520, sideToMove: "black", themes: [], solution: [
      { from: [6, 0], to: [7, 0], promotion: "q" }, { from: [1, 7], to: [0, 7], promotion: "N" },
    ] });
  });

  test.each(["", "?targetRating=abc", "?targetRating=1500&range=0", "?targetRating=1500&range=501", "?targetRating=1500&excludeId=bad"])("GET /adaptive rejects invalid parameters %s", async (query) => {
    expect((await request(buildApp()).get(`/api/puzzles/adaptive${query}`)).status).toBe(400);
    expect(puzzleModel.getAdaptivePuzzle).not.toHaveBeenCalled();
  });

  test("GET /adaptive reports an empty rating window and database errors", async () => {
    puzzleModel.getAdaptivePuzzle.mockResolvedValueOnce(null);
    expect((await request(buildApp()).get("/api/puzzles/adaptive?targetRating=1500")).status).toBe(404);
    puzzleModel.getAdaptivePuzzle.mockRejectedValueOnce(new Error("database unavailable"));
    expect((await request(buildApp()).get("/api/puzzles/adaptive?targetRating=1500")).status).toBe(500);
  });

	test("POST /:id/verify rewards an exact valid solution", async () => {
		const id = "11111111-1111-4111-8111-111111111111";
		const token = jwt.sign({ address: "GPLAYER" }, "puzzle-test-secret", { expiresIn: "1h" });
		puzzleModel.getById.mockResolvedValue({ id, solution_moves: ["e2e4", "e7e5"] });
		userModel.recordPuzzleSolve.mockResolvedValue({ awarded: true, points: 10, streak: 2 });

		const response = await request(buildApp())
			.post(`/api/puzzles/${id}/verify`)
			.set("Authorization", `Bearer ${token}`)
			.send({ moves: ["E2E4", "e7e5"] });

		expect(response.status).toBe(200);
		expect(response.body).toMatchObject({ success: true, correct: true });
		expect(userModel.recordPuzzleSolve).toHaveBeenCalledWith(
			"GPLAYER",
			id,
			expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
			10,
		);
	});

	test("POST /:id/verify rejects an incorrect line without a reward", async () => {
		const id = "11111111-1111-4111-8111-111111111111";
		const token = jwt.sign({ address: "GPLAYER" }, "puzzle-test-secret", { expiresIn: "1h" });
		puzzleModel.getById.mockResolvedValue({ id, solution_moves: ["e2e4", "e7e5"] });

		const response = await request(buildApp())
			.post(`/api/puzzles/${id}/verify`)
			.set("Authorization", `Bearer ${token}`)
			.send({ moves: ["e2e4", "c7c5"] });

		expect(response.status).toBe(200);
		expect(response.body).toEqual({ success: true, correct: false, reward: null });
		expect(userModel.recordPuzzleSolve).not.toHaveBeenCalled();
	});
});
