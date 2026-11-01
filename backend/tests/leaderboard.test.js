const request = require("supertest");
const express = require("express");
const gameRoutes = require("../routes/gameRoutes");
const leaderboardService = require("../services/leaderboardService");
const { getRedisClient } = require("../config/redis");

jest.mock("../config/redis", () => ({
	getRedisClient: jest.fn(),
	getRedisConnection: jest.fn(),
	closeRedis: jest.fn(),
	getPubSubClients: jest.fn(() => ({ pubClient: null, subClient: null })),
}));

function buildApp() {
	const app = express();
	app.use(express.json());
	app.use("/api", gameRoutes);
	return app;
}

function createMockRedis(initialStore = {}) {
	const store = new Map(Object.entries(initialStore));
	return {
		store,
		get: jest.fn(async (key) => (store.has(key) ? store.get(key) : null)),
		setex: jest.fn(async (key, ttl, value) => {
			store.set(key, value);
			return "OK";
		}),
		keys: jest.fn(async (pattern) => {
			const prefix = pattern.replace(/\*$/, "");
			return Array.from(store.keys()).filter((k) => k.startsWith(prefix));
		}),
		del: jest.fn(async (...keys) => {
			let deleted = 0;
			for (const k of keys) {
				if (store.delete(k)) deleted++;
			}
			return deleted;
		}),
	};
}

describe("GET /api/leaderboard", () => {
	let mockRedis;

	beforeEach(() => {
		mockRedis = createMockRedis();
		getRedisClient.mockReturnValue(mockRedis);

		jest.spyOn(leaderboardService, "getFinishedGames").mockResolvedValue([
			{
				player_white_address: "WHITE_ADDR",
				player_black_address: "BLACK_ADDR",
				winner: "white",
				wager_amount: 10,
				time_control_seconds: 300,
			},
		]);
		jest.spyOn(leaderboardService, "getPlayerProfiles").mockResolvedValue(new Map());
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it("returns 200 and leaderboard array matching LeaderboardEntry schema with X-Cache: MISS on first call", async () => {
		const app = buildApp();
		const res = await request(app).get("/api/leaderboard");
		expect(res.status).toBe(200);
		expect(res.headers["x-cache"]).toBe("MISS");
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

	it("serves subsequent repeated requests from cache with X-Cache: HIT", async () => {
		const app = buildApp();

		const firstRes = await request(app).get("/api/leaderboard?limit=100");
		expect(firstRes.status).toBe(200);
		expect(firstRes.headers["x-cache"]).toBe("MISS");
		expect(leaderboardService.getFinishedGames).toHaveBeenCalledTimes(1);

		const secondRes = await request(app).get("/api/leaderboard?limit=100");
		expect(secondRes.status).toBe(200);
		expect(secondRes.headers["x-cache"]).toBe("HIT");
		expect(secondRes.body.data).toEqual(firstRes.body.data);
		// Underlying database query not called again on cache HIT
		expect(leaderboardService.getFinishedGames).toHaveBeenCalledTimes(1);
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

describe("LeaderboardService caching and invalidation logic", () => {
	let mockRedis;

	beforeEach(() => {
		mockRedis = createMockRedis();
		getRedisClient.mockReturnValue(mockRedis);
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it("uses chesster:leaderboard:top100 as cache key for top 100 players", () => {
		const key = leaderboardService.getCacheKey("all", 100, 0);
		expect(key).toBe("chesster:leaderboard:top100");
	});

	it("stores payload in Redis with 60s expiration TTL", async () => {
		const mockGames = [
			{
				player_white_address: "P1",
				player_black_address: "P2",
				winner: "white",
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
		const result = await service.getLeaderboard({ limit: 100, offset: 0 });

		expect(result.length).toBe(2);
		expect(mockRedis.setex).toHaveBeenCalledWith(
			"chesster:leaderboard:top100",
			60,
			JSON.stringify(result)
		);
	});

	it("invalidateLeaderboardCache() clears the cached key on demand", async () => {
		mockRedis.store.set("chesster:leaderboard:top100", JSON.stringify([{ rank: 1 }]));
		mockRedis.store.set("chesster:leaderboard:blitz:50:0", JSON.stringify([{ rank: 1 }]));

		expect(mockRedis.store.has("chesster:leaderboard:top100")).toBe(true);

		await leaderboardService.invalidateLeaderboardCache();

		expect(mockRedis.store.has("chesster:leaderboard:top100")).toBe(false);
		expect(mockRedis.store.has("chesster:leaderboard:blitz:50:0")).toBe(false);
	});

	it("benchmark test: confirms database query count does not scale linearly with request volume", async () => {
		let queryCount = 0;
		const mockDb = {
			from: () => {
				queryCount++;
				return {
					select: () => ({
						eq: () => Promise.resolve({
							data: [
								{
									player_white_address: "ALICE",
									player_black_address: "BOB",
									winner: "white",
									time_control_seconds: 300,
								},
							],
							error: null,
						}),
						in: () => Promise.resolve({ data: [], error: null }),
					}),
				};
			},
		};

		const service = new leaderboardService.constructor({ database: mockDb });

		// Initial request (cache miss) populates the cache
		const firstRes = await service.getLeaderboard({ limit: 100, offset: 0 });
		expect(firstRes.length).toBe(2);
		expect(queryCount).toBe(2); // 1 for games + 1 for profiles

		// Subsequent 50 requests are served directly from cache without hitting the database
		for (let i = 0; i < 50; i++) {
			const cachedRes = await service.getLeaderboard({ limit: 100, offset: 0 });
			expect(cachedRes.length).toBe(2);
		}

		// Database query count remains completely unchanged despite 50 additional requests
		expect(queryCount).toBe(2);
	});

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

		// Bypass redis cache for unit logic verification
		getRedisClient.mockReturnValue(null);
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

		getRedisClient.mockReturnValue(null);
		const service = new leaderboardService.constructor({ database: mockDb });

		const bulletResult = await service.getLeaderboard({ category: "bullet" });
		expect(bulletResult.some((p) => p.address === "P_BULLET")).toBe(true);
		expect(bulletResult.some((p) => p.address === "P_RAPID")).toBe(false);

		const rapidResult = await service.getLeaderboard({ category: "rapid" });
		expect(rapidResult.some((p) => p.address === "P_RAPID")).toBe(true);
		expect(rapidResult.some((p) => p.address === "P_BULLET")).toBe(false);
	});
});
