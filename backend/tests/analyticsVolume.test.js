const express = require("express");
const request = require("supertest");

jest.mock("../config/supabase");
jest.mock("../config/redis", () => ({ getRedisClient: jest.fn(() => null) }));

const supabase = require("../config/supabase");
const redisConfig = require("../config/redis");
const analyticsService = require("../services/analyticsService");

function mockGames(rows, error = null) {
	const gte = jest.fn().mockResolvedValue({ data: rows, error });
	const select = jest.fn().mockReturnValue({ gte });
	supabase.from = jest.fn().mockReturnValue({ select });
	return { gte, select };
}

const GAMES = [
	{ wager_amount: "10", token_address: null, player_white_address: "A", player_black_address: "B" },
	{ wager_amount: "5.5", token_address: null, player_white_address: "A", player_black_address: "C" },
	{ wager_amount: "100", token_address: "CUSDCTOKEN", player_white_address: "A", player_black_address: "D" },
	{ wager_amount: "50", token_address: "CUSDCTOKEN", player_white_address: "D", player_black_address: "E" },
	{ wager_amount: "20", token_address: "GEURCISSUER", player_white_address: "F", player_black_address: null },
];

describe("analyticsService.getRolling24HourVolume", () => {
	beforeEach(async () => {
		jest.clearAllMocks();
		redisConfig.getRedisClient.mockReturnValue(null);
		delete process.env.USDC_TOKEN_ADDRESS;
		delete process.env.EURC_TOKEN_ADDRESS;
		await analyticsService.invalidateRolling24HourVolumeCache();
	});

	test("segments volume, matches, unique players and average by asset", async () => {
		mockGames(GAMES);
		const result = await analyticsService.getRolling24HourVolume();

		expect(result.window).toBe("24h");
		expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
		const byAsset = Object.fromEntries(result.assets.map((a) => [a.asset, a]));

		expect(byAsset.XLM).toEqual({
			asset: "XLM", totalVolume: "15.5000000", matchCount: 2, uniquePlayers: 3, averageWager: "7.7500000",
		});
		expect(byAsset.USDC).toEqual({
			asset: "USDC", totalVolume: "150.00", matchCount: 2, uniquePlayers: 3, averageWager: "75.00",
		});
		expect(byAsset.EURC).toEqual({
			asset: "EURC", totalVolume: "20.00", matchCount: 1, uniquePlayers: 1, averageWager: "20.00",
		});
	});

	test("queries only games created within the last 24 hours", async () => {
		const { gte } = mockGames([]);
		const before = Date.now();
		await analyticsService.getRolling24HourVolume();
		const [column, since] = gte.mock.calls[0];
		expect(column).toBe("created_at");
		const delta = before - 24 * 3600 * 1000 - new Date(since).getTime();
		expect(Math.abs(delta)).toBeLessThan(5000);
	});

	test("returns an empty asset list when there are no games", async () => {
		mockGames([]);
		const result = await analyticsService.getRolling24HourVolume();
		expect(result.assets).toEqual([]);
	});

	test("resolves assets using configured token addresses", async () => {
		process.env.USDC_TOKEN_ADDRESS = "CABCDEF";
		mockGames([{ wager_amount: 1, token_address: "cabcdef", player_white_address: "A", player_black_address: "B" }]);
		const result = await analyticsService.getRolling24HourVolume();
		expect(result.assets[0].asset).toBe("USDC");
	});

	test("reports unknown tokens under their raw address", () => {
		expect(analyticsService.resolveAssetSymbol("CSOMETOKEN")).toBe("CSOMETOKEN");
		expect(analyticsService.resolveAssetSymbol(null)).toBe("XLM");
		expect(analyticsService.resolveAssetSymbol("  ")).toBe("XLM");
	});

	test("serves the second call from cache and queries the database once", async () => {
		mockGames(GAMES);
		const first = await analyticsService.getRolling24HourVolume();
		const second = await analyticsService.getRolling24HourVolume();
		expect(second).toEqual(first);
		expect(supabase.from).toHaveBeenCalledTimes(1);
	});

	test("recomputes after the 5 minute TTL expires", async () => {
		jest.useFakeTimers().setSystemTime(new Date("2026-10-17T12:00:00Z"));
		try {
			mockGames(GAMES);
			await analyticsService.getRolling24HourVolume();
			jest.setSystemTime(new Date("2026-10-17T12:04:59Z"));
			await analyticsService.getRolling24HourVolume();
			expect(supabase.from).toHaveBeenCalledTimes(1);
			jest.setSystemTime(new Date("2026-10-17T12:05:01Z"));
			await analyticsService.getRolling24HourVolume();
			expect(supabase.from).toHaveBeenCalledTimes(2);
		} finally {
			jest.useRealTimers();
		}
	});

	test("bypassCache forces a recompute", async () => {
		mockGames(GAMES);
		await analyticsService.getRolling24HourVolume();
		await analyticsService.getRolling24HourVolume({ bypassCache: true });
		expect(supabase.from).toHaveBeenCalledTimes(2);
	});

	test("writes to and reads from Redis when available", async () => {
		const store = {};
		const redis = {
			get: jest.fn(async (k) => store[k] || null),
			set: jest.fn(async (k, v) => { store[k] = v; }),
			del: jest.fn(async (k) => { delete store[k]; }),
		};
		redisConfig.getRedisClient.mockReturnValue(redis);

		mockGames(GAMES);
		const first = await analyticsService.getRolling24HourVolume();
		expect(redis.set).toHaveBeenCalledWith("analytics:volume-24h", expect.any(String), "PX", 300000);

		const second = await analyticsService.getRolling24HourVolume();
		expect(second).toEqual(first);
		expect(supabase.from).toHaveBeenCalledTimes(1);

		await analyticsService.invalidateRolling24HourVolumeCache();
		expect(redis.del).toHaveBeenCalledWith("analytics:volume-24h");
	});

	test("falls back to memory when Redis calls fail", async () => {
		const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
		redisConfig.getRedisClient.mockReturnValue({
			get: jest.fn().mockRejectedValue(new Error("boom")),
			set: jest.fn().mockRejectedValue(new Error("boom")),
			del: jest.fn(),
		});
		mockGames(GAMES);
		await analyticsService.getRolling24HourVolume();
		await analyticsService.getRolling24HourVolume();
		expect(supabase.from).toHaveBeenCalledTimes(1);
		warn.mockRestore();
	});

	test("propagates database errors and does not cache them", async () => {
		const spy = jest.spyOn(console, "error").mockImplementation(() => {});
		mockGames(null, new Error("db down"));
		await expect(analyticsService.getRolling24HourVolume()).rejects.toThrow("db down");
		mockGames(GAMES);
		const result = await analyticsService.getRolling24HourVolume();
		expect(result.assets.length).toBeGreaterThan(0);
		spy.mockRestore();
	});
});

describe("GET /api/analytics/volume-24h", () => {
	let app;
	beforeAll(() => {
		const gameController = require("../controllers/gameController");
		app = express();
		app.get("/api/analytics/volume-24h", gameController.getRolling24HourVolume);
	});

	beforeEach(async () => {
		jest.clearAllMocks();
		redisConfig.getRedisClient.mockReturnValue(null);
		await analyticsService.invalidateRolling24HourVolumeCache();
	});

	test("returns the documented payload shape", async () => {
		mockGames(GAMES);
		const res = await request(app).get("/api/analytics/volume-24h");
		expect(res.status).toBe(200);
		expect(res.body.window).toBe("24h");
		expect(typeof res.body.timestamp).toBe("string");
		expect(res.body.assets.find((a) => a.asset === "USDC")).toMatchObject({
			totalVolume: "150.00", matchCount: 2, uniquePlayers: 3,
		});
	});

	test("is registered on the game router", () => {
		const router = require("../routes/gameRoutes");
		const hit = router.stack.some(
			(l) => l.route && l.route.path === "/analytics/volume-24h" && l.route.methods.get
		);
		expect(hit).toBe(true);
	});

	test("returns 500 with a generic message on failure", async () => {
		const spy = jest.spyOn(console, "error").mockImplementation(() => {});
		mockGames(null, new Error("secret db detail"));
		const res = await request(app).get("/api/analytics/volume-24h");
		expect(res.status).toBe(500);
		expect(JSON.stringify(res.body)).not.toContain("secret db detail");
		spy.mockRestore();
	});
});
