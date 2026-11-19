const express = require("express");
const request = require("supertest");

jest.mock("../config/redis", () => ({ getRedisConnection: jest.fn(), getRedisClient: jest.fn() }));
jest.mock("../models/userModel", () => ({ getUserProfile: jest.fn() }));
jest.mock("../services/leaderboardService", () => ({ getPlayerRankAndPercentile: jest.fn() }));

const userModel = require("../models/userModel");
const leaderboardService = require("../services/leaderboardService");
const routes = require("../routes/authRoutes");

describe("GET /api/users/:address/profile percentile (#642)", () => {
	let app;
	beforeEach(() => {
		jest.clearAllMocks();
		app = express();
		app.use(express.json());
		app.use("/api", routes);
		userModel.getUserProfile.mockResolvedValue({ wallet_address: "GABC", rating: 1650 });
	});

	it("exposes rank and percentile in the profile response", async () => {
		leaderboardService.getPlayerRankAndPercentile.mockResolvedValue({ rank: 6, totalPlayers: 100, percentile: 94 });
		const res = await request(app).get("/api/users/GABC/profile");
		expect(res.status).toBe(200);
		expect(res.body.data).toMatchObject({ wallet_address: "GABC", rank: 6, percentile: 94 });
		expect(leaderboardService.getPlayerRankAndPercentile).toHaveBeenCalledWith("GABC");
	});

	it("returns null percentile for unranked players", async () => {
		leaderboardService.getPlayerRankAndPercentile.mockResolvedValue({ rank: null, percentile: null });
		const res = await request(app).get("/api/users/GABC/profile");
		expect(res.body.data.percentile).toBeNull();
	});

	it("still serves the profile when the ranking lookup fails", async () => {
		leaderboardService.getPlayerRankAndPercentile.mockRejectedValue(new Error("boom"));
		const res = await request(app).get("/api/users/GABC/profile");
		expect(res.status).toBe(200);
		expect(res.body.data).toMatchObject({ wallet_address: "GABC", rank: null, percentile: null });
	});

	it("returns 404 without ranking lookup when the profile does not exist", async () => {
		userModel.getUserProfile.mockResolvedValue(null);
		const res = await request(app).get("/api/users/GNONE/profile");
		expect(res.status).toBe(404);
		expect(leaderboardService.getPlayerRankAndPercentile).not.toHaveBeenCalled();
	});
});
