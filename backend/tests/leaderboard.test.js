const request = require("supertest");
const express = require("express");
const gameRoutes = require("../routes/gameRoutes");
const leaderboardService = require("../services/leaderboardService");

function buildApp() {
	const app = express();
	app.use(express.json());
	app.use("/api", gameRoutes);
	return app;
}

describe("GET /api/leaderboard", () => {
	it("returns 200 and leaderboard array matching LeaderboardEntry schema", async () => {
		const res = await request(buildApp()).get("/api/leaderboard");
		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(Array.isArray(res.body.data)).toBe(true);

		if (res.body.data.length > 0) {
			const top = res.body.data[0];
			expect(top).toHaveProperty("rank", 1);
			expect(top).toHaveProperty("address");
			expect(top).toHaveProperty("elo");
			expect(top).toHaveProperty("wins");
			expect(top).toHaveProperty("losses");
			expect(top).toHaveProperty("draws");
			expect(top).toHaveProperty("winRate");
			expect(top).toHaveProperty("totalEarnings");
		}
	});

	it("filters by category=all, bullet, blitz, rapid", async () => {
		for (const cat of ["all", "bullet", "blitz", "rapid"]) {
			const res = await request(buildApp()).get(`/api/leaderboard?category=${cat}`);
			expect(res.status).toBe(200);
			expect(res.body.success).toBe(true);
			expect(Array.isArray(res.body.data)).toBe(true);
		}
	});

	it("respects limit and offset parameters", async () => {
		const res = await request(buildApp()).get("/api/leaderboard?limit=1&offset=0");
		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.data.length).toBeLessThanOrEqual(1);
	});
});

describe("LeaderboardService unit logic", () => {
	it("correctly aggregates and ranks players from finished games", async () => {
		const mockGames = [
			{
				player_white_address: "PLAYER_A",
				player_black_address: "PLAYER_B",
				winner: "white",
				wager_amount: 10,
				time_control_seconds: 300,
			},
			{
				player_white_address: "PLAYER_A",
				player_black_address: "PLAYER_C",
				winner: "white",
				wager_amount: 5,
				time_control_seconds: 300,
			},
			{
				player_white_address: "PLAYER_B",
				player_black_address: "PLAYER_C",
				winner: "draw",
				wager_amount: null,
				time_control_seconds: 300,
			},
		];

		const mockDb = {
			from: () => ({
				select: () => ({
					eq: () => Promise.resolve({ data: mockGames, error: null }),
					in: () => Promise.resolve({ data: [], error: null }),
				}),
			}),
		};

		const service = new leaderboardService.constructor({ database: mockDb });
		const result = await service.getLeaderboard();

		expect(result.length).toBe(3);
		expect(result[0].address).toBe("PLAYER_A");
		expect(result[0].rank).toBe(1);
		expect(result[0].wins).toBe(2);
		expect(result[0].losses).toBe(0);
		expect(result[0].winRate).toBe(1);
		expect(result[0].totalEarnings).toBe(15);
		expect(result[0].elo).toBe(1232); // 1200 + 2*16

		expect(result[1].address).toBe("PLAYER_B");
		expect(result[1].rank).toBe(2);
		expect(result[1].draws).toBe(1);

		expect(result[2].address).toBe("PLAYER_C");
		expect(result[2].rank).toBe(3);
		expect(result[2].losses).toBe(1);
	});

	it("filters by time-control category accurately", async () => {
		const mockGames = [
			{
				player_white_address: "P_BULLET",
				player_black_address: "P_OTHER",
				winner: "white",
				time_control_seconds: 120,
			},
			{
				player_white_address: "P_RAPID",
				player_black_address: "P_OTHER",
				winner: "white",
				time_control_seconds: 900,
			},
		];

		const mockDb = {
			from: () => ({
				select: () => ({
					eq: () => Promise.resolve({ data: mockGames, error: null }),
					in: () => Promise.resolve({ data: [], error: null }),
				}),
			}),
		};

		const service = new leaderboardService.constructor({ database: mockDb });

		const bulletResult = await service.getLeaderboard({ category: "bullet" });
		expect(bulletResult.some((p) => p.address === "P_BULLET")).toBe(true);
		expect(bulletResult.some((p) => p.address === "P_RAPID")).toBe(false);

		const rapidResult = await service.getLeaderboard({ category: "rapid" });
		expect(rapidResult.some((p) => p.address === "P_RAPID")).toBe(true);
		expect(rapidResult.some((p) => p.address === "P_BULLET")).toBe(false);
	});
});
