const express = require("express");
const request = require("supertest");

jest.mock("../models/gameModel", () => ({
	getGame: jest.fn(),
	makeMove: jest.fn(),
	resignGame: jest.fn(),
	acceptDraw: jest.fn(),
	claimDraw: jest.fn(),
}));
jest.mock("../models/userModel", () => ({
	invalidateProfileCache: jest.fn().mockResolvedValue(undefined),
	invalidateProfilesForGame: jest.fn().mockResolvedValue(undefined),
	getUserProfile: jest.fn(),
}));
// authService pulls in the Stellar SDK (ESM-only deps Jest can't parse);
// the profile route under test doesn't use it.
jest.mock("../services/authService", () => ({}));
jest.mock("../models/tournamentModel", () => ({ getMatchByGameCode: jest.fn().mockResolvedValue(null) }));
jest.mock("../services/tournamentService", () => ({ advanceRound: jest.fn() }));
jest.mock("../services/timerService", () => ({
	applyMove: jest.fn(() => null),
	clearTimer: jest.fn(),
	clearClock: jest.fn(),
}));

const gameModel = require("../models/gameModel");
const userModel = require("../models/userModel");
const gameRoutes = require("../routes/gameRoutes");
const authRoutes = require("../routes/authRoutes");

const FINISHED = {
	game_code: "END123",
	status: "finished",
	winner: "white",
	current_turn: "black",
	player_white_address: "GWHITE",
	player_black_address: "GBLACK",
};

function buildApp() {
	const app = express();
	app.use(express.json());
	app.set("io", { to: jest.fn(() => ({ emit: jest.fn() })) });
	app.use("/api", gameRoutes);
	app.use("/api", authRoutes);
	return app;
}

describe("profile cache invalidation on match end", () => {
	let app;

	beforeEach(() => {
		jest.clearAllMocks();
		app = buildApp();
	});

	it("endGame invalidates both players' cached profiles", async () => {
		gameModel.getGame.mockResolvedValue({ ...FINISHED, status: "active" });

		const res = await request(app).post("/api/games/END123/end").send({ winner: "white" });

		expect(res.status).toBe(200);
		expect(userModel.invalidateProfileCache).toHaveBeenCalledWith("GWHITE", "GBLACK");
	});

	it("a checkmating move invalidates both players' profiles", async () => {
		gameModel.getGame.mockResolvedValue({ ...FINISHED, status: "active", current_turn: "white" });
		gameModel.makeMove.mockResolvedValue(FINISHED);

		const res = await request(app).post("/api/games/END123/move").send({ from: [6, 4], to: [4, 4] });

		expect(res.status).toBe(200);
		expect(userModel.invalidateProfilesForGame).toHaveBeenCalledWith(FINISHED);
	});

	it("an ordinary move leaves the caches alone", async () => {
		const active = { ...FINISHED, status: "active", winner: null };
		gameModel.getGame.mockResolvedValue(active);
		gameModel.makeMove.mockResolvedValue(active);

		await request(app).post("/api/games/END123/move").send({ from: [6, 4], to: [4, 4] });

		expect(userModel.invalidateProfilesForGame).not.toHaveBeenCalled();
		expect(userModel.invalidateProfileCache).not.toHaveBeenCalled();
	});

	it.each([
		["resign", "resignGame", { playerColor: "black" }],
		["draw/accept", "acceptDraw", {}],
		["draw/claim", "claimDraw", {}],
	])("POST /%s invalidates both players' profiles", async (path, method, body) => {
		gameModel[method].mockResolvedValue(FINISHED);

		const res = await request(app).post(`/api/games/END123/${path}`).send(body);

		expect(res.status).toBe(200);
		expect(userModel.invalidateProfilesForGame).toHaveBeenCalledWith(FINISHED);
	});

	describe("GET /api/users/:address/profile", () => {
		it("returns the (cached) public profile", async () => {
			const profile = { wallet_address: "GWHITE", username: "w", stats: { gamesPlayed: 3 }, recentMatches: [] };
			userModel.getUserProfile.mockResolvedValue(profile);

			const res = await request(app).get("/api/users/GWHITE/profile");

			expect(res.status).toBe(200);
			expect(res.body).toEqual({ success: true, data: profile });
			expect(userModel.getUserProfile).toHaveBeenCalledWith("GWHITE");
		});

		it("returns 404 for unknown players", async () => {
			userModel.getUserProfile.mockResolvedValue(null);
			const res = await request(app).get("/api/users/GNOBODY/profile");
			expect(res.status).toBe(404);
		});
	});
});
