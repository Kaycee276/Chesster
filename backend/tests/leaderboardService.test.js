const Redis = require("ioredis-mock");

jest.mock("../config/redis", () => ({
	getRedisClient: jest.fn(),
	getRedisConnection: jest.fn(),
}));

const { getRedisClient } = require("../config/redis");
const { LeaderboardService } = require("../services/leaderboardService");

const KEY = "leaderboard:active_players";

function buildService(players) {
	const findMany = jest.fn().mockResolvedValue(
		players.map(([wallet_address, elo_rating]) => ({ wallet_address, elo_rating })),
	);
	const service = new LeaderboardService({ database: { prisma: { player: { findMany } } } });
	return { service, findMany };
}

function hundredPlayers() {
	// P1 has 2000, P2 1999, ... P100 1901
	return Array.from({ length: 100 }, (_, i) => [`P${i + 1}`, 2000 - i]);
}

describe("getPlayerRankAndPercentile (#642)", () => {
	let redis;

	beforeEach(async () => {
		redis = new Redis();
		await redis.flushall();
		getRedisClient.mockReturnValue(redis);
		jest.spyOn(console, "warn").mockImplementation(() => {});
	});

	afterEach(() => jest.restoreAllMocks());

	it("computes top-tier, median and bottom-tier percentiles across 100 players", async () => {
		const { service } = buildService(hundredPlayers());

		expect(await service.getPlayerRankAndPercentile("P1")).toEqual({ rank: 1, totalPlayers: 100, percentile: 99 });
		expect(await service.getPlayerRankAndPercentile("P50")).toEqual({ rank: 50, totalPlayers: 100, percentile: 50 });
		// Bottom player would be 0%, floored to 0.1 per the issue.
		expect(await service.getPlayerRankAndPercentile("P100")).toEqual({ rank: 100, totalPlayers: 100, percentile: 0.1 });
	});

	it("handles a single player", async () => {
		const { service } = buildService([["SOLO", 1500]]);
		expect(await service.getPlayerRankAndPercentile("SOLO")).toEqual({ rank: 1, totalPlayers: 1, percentile: 0.1 });
	});

	it("formats percentile to one decimal place", async () => {
		const { service } = buildService([["A", 1700], ["B", 1600], ["C", 1500]]);
		expect((await service.getPlayerRankAndPercentile("A")).percentile).toBe(66.7);
	});

	it("gives tied ratings the same rank and percentile", async () => {
		const { service } = buildService([["A", 1800], ["B", 1500], ["C", 1500], ["D", 1500], ["E", 1000]]);
		const b = await service.getPlayerRankAndPercentile("B");
		const c = await service.getPlayerRankAndPercentile("C");
		const d = await service.getPlayerRankAndPercentile("D");
		expect(b).toEqual({ rank: 2, totalPlayers: 5, percentile: 60 });
		expect(c).toEqual(b);
		expect(d).toEqual(b);
		expect((await service.getPlayerRankAndPercentile("E")).rank).toBe(5);
	});

	it("returns nulls for an unknown player", async () => {
		const { service } = buildService([["A", 1800]]);
		expect(await service.getPlayerRankAndPercentile("GHOST")).toEqual({ rank: null, percentile: null });
	});

	it("returns nulls when there are no active players or no address", async () => {
		const { service } = buildService([]);
		expect(await service.getPlayerRankAndPercentile("A")).toEqual({ rank: null, percentile: null });
		expect(await service.getPlayerRankAndPercentile(undefined)).toEqual({ rank: null, percentile: null });
	});

	it("caches the sorted set with a 15 minute TTL and does not requery the database", async () => {
		const { service, findMany } = buildService(hundredPlayers());
		await service.getPlayerRankAndPercentile("P1");
		await service.getPlayerRankAndPercentile("P2");

		expect(findMany).toHaveBeenCalledTimes(1);
		expect(await redis.zcard(KEY)).toBe(100);
		const ttl = await redis.ttl(KEY);
		expect(ttl).toBeGreaterThan(890);
		expect(ttl).toBeLessThanOrEqual(900);
	});

	it("rebuilds the sorted set after it expires", async () => {
		const { service, findMany } = buildService([["A", 1800], ["B", 1700]]);
		await service.getPlayerRankAndPercentile("A");
		await redis.del(KEY);
		await service.getPlayerRankAndPercentile("A");
		expect(findMany).toHaveBeenCalledTimes(2);
	});

	it("refreshLeaderboardCache replaces stale members and leaves no temp key behind", async () => {
		await redis.zadd(KEY, 999, "STALE");
		const { service } = buildService([["A", 1800], ["B", 1700]]);
		expect(await service.refreshLeaderboardCache()).toBe(2);
		expect(await redis.zrange(KEY, 0, -1)).toEqual(["B", "A"]);
		expect((await redis.keys("leaderboard:*")).sort()).toEqual([KEY]);
	});

	it("shares one rebuild between concurrent callers", async () => {
		const { service, findMany } = buildService(hundredPlayers());
		await Promise.all([service.getPlayerRankAndPercentile("P1"), service.getPlayerRankAndPercentile("P2")]);
		expect(findMany).toHaveBeenCalledTimes(1);
	});

	it("falls back to the database when Redis is unavailable", async () => {
		getRedisClient.mockReturnValue(null);
		const { service } = buildService(hundredPlayers());
		expect(await service.getPlayerRankAndPercentile("P1")).toEqual({ rank: 1, totalPlayers: 100, percentile: 99 });
		expect(await service.getPlayerRankAndPercentile("P50")).toEqual({ rank: 50, totalPlayers: 100, percentile: 50 });
		expect(await service.getPlayerRankAndPercentile("GHOST")).toEqual({ rank: null, percentile: null });
	});

	it("falls back to the database when a Redis command fails", async () => {
		const broken = { zcard: jest.fn().mockRejectedValue(new Error("connection lost")) };
		getRedisClient.mockReturnValue(broken);
		const { service } = buildService([["A", 1800], ["B", 1700]]);
		expect(await service.getPlayerRankAndPercentile("B")).toEqual({ rank: 2, totalPlayers: 2, percentile: 0.1 });
	});

	it("falls back to the supabase-style client when prisma is unavailable", async () => {
		getRedisClient.mockReturnValue(null);
		const eq = jest.fn().mockResolvedValue({
			data: [{ wallet_address: "A", elo_rating: 1800 }, { wallet_address: "B", elo_rating: 1700 }],
			error: null,
		});
		const service = new LeaderboardService({ database: { from: () => ({ select: () => ({ eq }) }) } });
		expect(await service.getPlayerRankAndPercentile("A")).toEqual({ rank: 1, totalPlayers: 2, percentile: 50 });
	});
});
