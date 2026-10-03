process.env.JWT_SECRET = "puzzle-test-secret";

const express = require("express");
const jwt = require("jsonwebtoken");
const request = require("supertest");

jest.mock("../models/puzzleModel", () => ({
	getDailyPuzzle: jest.fn(),
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
