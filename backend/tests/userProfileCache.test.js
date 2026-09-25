jest.mock("../config/redis", () => ({ getRedisClient: jest.fn(), closeRedis: jest.fn() }));

jest.mock("../config/supabase", () => {
	// Tiny query-builder fake over in-memory tables, counting table reads.
	const tables = {};
	const reads = [];
	const from = (table) => {
		reads.push(table);
		const q = { filters: [], order: null, limit: Infinity, update: null };
		const rows = () => {
			let result = (tables[table] || []).filter((r) => q.filters.every(([c, v]) => r[c] === v));
			if (q.order) {
				const [c, asc] = q.order;
				result = result.slice().sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (asc ? 1 : -1));
			}
			return result.slice(0, q.limit);
		};
		const b = {
			select: () => b,
			eq: (c, v) => (q.filters.push([c, v]), b),
			order: (c, { ascending = true } = {}) => ((q.order = [c, ascending]), b),
			limit: (n) => ((q.limit = n), b),
			update: (values) => ((q.update = values), b),
			maybeSingle: () => Promise.resolve({ data: rows()[0] || null, error: null }),
			single: () => {
				const [row] = rows();
				if (row && q.update) Object.assign(row, q.update);
				return Promise.resolve({ data: row || null, error: null });
			},
			then: (resolve, reject) => Promise.resolve({ data: rows(), error: null }).then(resolve, reject),
		};
		return b;
	};
	return {
		from,
		rpc: jest.fn(),
		__tables: tables,
		__reads: reads,
	};
});

const { getRedisClient } = require("../config/redis");
const supabase = require("../config/supabase");
const userModel = require("../models/userModel");

const ME = "GPLAYERAAA";

/** In-memory stand-in for an ioredis client. */
function fakeRedis() {
	const store = new Map();
	return {
		store,
		get: jest.fn(async (key) => (store.has(key) ? store.get(key).value : null)),
		setex: jest.fn(async (key, ttl, value) => {
			store.set(key, { value, ttl });
			return "OK";
		}),
		del: jest.fn(async (...keys) => keys.filter((key) => store.delete(key)).length),
	};
}

function seed() {
	supabase.__tables.users = [
		{ id: "u1", wallet_address: ME, username: "alice", bio: "hi", elo_rating: 1450 },
		{ id: "u2", wallet_address: "GOPPONENT", username: "bob", elo_rating: 1300 },
	];
	supabase.__tables.player_stats = [{ wallet_address: ME, games_played: 8, wins: 5, losses: 2, draws: 1 }];
	supabase.__tables.games = [
		{ game_code: "G1", status: "finished", winner: "white", end_reason: "checkmate", player_white_address: ME, player_black_address: "GOPPONENT", wager_amount: 10, move_count: 40, updated_at: "2026-03-01T10:00:00.000Z" },
		{ game_code: "G2", status: "finished", winner: "white", end_reason: "resignation", player_white_address: "GOPPONENT", player_black_address: ME, wager_amount: null, move_count: 22, updated_at: "2026-03-03T10:00:00.000Z" },
		{ game_code: "G3", status: "finished", winner: "draw", end_reason: "draw_agreed", player_white_address: ME, player_black_address: "GOPPONENT", move_count: 60, updated_at: "2026-03-02T10:00:00.000Z" },
		{ game_code: "G4", status: "active", winner: null, player_white_address: ME, player_black_address: "GOPPONENT", updated_at: "2026-03-04T10:00:00.000Z" },
	];
}

const dbReads = () => supabase.__reads.length;

describe("userModel profile cache", () => {
	let redis;
	let warn;

	beforeEach(() => {
		seed();
		supabase.__reads.length = 0;
		redis = fakeRedis();
		getRedisClient.mockReturnValue(redis);
		warn = jest.spyOn(console, "warn").mockImplementation(() => {});
	});

	afterEach(() => {
		warn.mockRestore();
		jest.clearAllMocks();
	});

	describe("fetchProfileFromDB", () => {
		it("aggregates stats, rating and recent finished matches", async () => {
			const profile = await userModel.fetchProfileFromDB(ME);

			expect(profile).toMatchObject({ wallet_address: ME, username: "alice", rating: 1450 });
			expect(profile.stats).toEqual({
				gamesPlayed: 8,
				wins: 5,
				losses: 2,
				draws: 1,
				winRate: 62.5,
				lossRate: 25,
				drawRate: 12.5,
			});
			expect(profile.recentMatches.map((m) => [m.gameCode, m.color, m.result])).toEqual([
				["G2", "black", "loss"],
				["G3", "white", "draw"],
				["G1", "white", "win"],
			]);
			expect(profile.recentMatches[2]).toMatchObject({ opponent: "GOPPONENT", endReason: "checkmate", wagerAmount: 10, moveCount: 40 });
		});

		it("reports zeroed stats for a player without a stats row", async () => {
			const profile = await userModel.fetchProfileFromDB("GOPPONENT");

			expect(profile.username).toBe("bob");
			expect(profile.stats).toEqual({ gamesPlayed: 0, wins: 0, losses: 0, draws: 0, winRate: 0, lossRate: 0, drawRate: 0 });
		});

		it("returns null for unknown addresses", async () => {
			expect(await userModel.fetchProfileFromDB("GNOBODY")).toBeNull();
		});
	});

	describe("getUserProfile", () => {
		it("populates the cache on a miss with a 600 second TTL", async () => {
			const profile = await userModel.getUserProfile(ME);

			expect(redis.get).toHaveBeenCalledWith(`cache:profile:${ME}`);
			expect(redis.setex).toHaveBeenCalledWith(`cache:profile:${ME}`, 600, JSON.stringify(profile));
			expect(dbReads()).toBeGreaterThan(0);
		});

		it("serves repeated queries from the cache without touching the database", async () => {
			const first = await userModel.getUserProfile(ME);
			const readsAfterFirst = dbReads();

			const second = await userModel.getUserProfile(ME);
			const third = await userModel.getUserProfile(ME);

			expect(second).toEqual(first);
			expect(third).toEqual(first);
			expect(dbReads()).toBe(readsAfterFirst);
			expect(redis.setex).toHaveBeenCalledTimes(1);
		});

		it("does not cache unknown users", async () => {
			expect(await userModel.getUserProfile("GNOBODY")).toBeNull();
			expect(redis.setex).not.toHaveBeenCalled();
		});

		it("falls back to the database when Redis is offline", async () => {
			getRedisClient.mockReturnValue(null);

			const first = await userModel.getUserProfile(ME);
			const reads = dbReads();
			const second = await userModel.getUserProfile(ME);

			expect(first.username).toBe("alice");
			expect(second).toEqual(first);
			expect(dbReads()).toBe(reads * 2);
		});

		it("falls back to the database when a cache read or write fails", async () => {
			redis.get.mockRejectedValue(new Error("Connection is closed."));
			redis.setex.mockRejectedValue(new Error("Connection is closed."));

			const profile = await userModel.getUserProfile(ME);

			expect(profile.username).toBe("alice");
			expect(dbReads()).toBeGreaterThan(0);
			expect(warn).toHaveBeenCalled();
		});
	});

	describe("invalidation", () => {
		it("invalidates a cached profile so the next query re-reads the database", async () => {
			await userModel.getUserProfile(ME);
			supabase.__tables.player_stats[0] = { wallet_address: ME, games_played: 9, wins: 6, losses: 2, draws: 1 };

			const stale = await userModel.getUserProfile(ME);
			expect(stale.stats.wins).toBe(5);

			await userModel.invalidateProfileCache(ME);
			const fresh = await userModel.getUserProfile(ME);
			expect(fresh.stats.wins).toBe(6);
		});

		it("deletes both players' keys once a game has finished", async () => {
			await userModel.invalidateProfilesForGame({ status: "finished", player_white_address: ME, player_black_address: "GOPPONENT" });

			expect(redis.del).toHaveBeenCalledWith(`cache:profile:${ME}`, "cache:profile:GOPPONENT");
		});

		it("leaves caches alone for games that are still in progress", async () => {
			await userModel.invalidateProfilesForGame({ status: "active", player_white_address: ME, player_black_address: "GOPPONENT" });
			await userModel.invalidateProfilesForGame(null);

			expect(redis.del).not.toHaveBeenCalled();
		});

		it("skips missing addresses and duplicate keys", async () => {
			await userModel.invalidateProfileCache(ME, null, ME, undefined);
			expect(redis.del).toHaveBeenCalledWith(`cache:profile:${ME}`);
		});

		it("never throws when Redis is offline or the delete fails", async () => {
			redis.del.mockRejectedValue(new Error("Connection is closed."));
			await expect(userModel.invalidateProfileCache(ME)).resolves.toBeUndefined();

			getRedisClient.mockReturnValue(null);
			await expect(userModel.invalidateProfileCache(ME)).resolves.toBeUndefined();
		});

		it("invalidates the owner's profile after a profile update", async () => {
			await userModel.getUserProfile(ME);
			await userModel.updateProfile(ME, { username: "alice2" });

			expect(redis.del).toHaveBeenCalledWith(`cache:profile:${ME}`);
			expect((await userModel.getUserProfile(ME)).username).toBe("alice2");
		});

		it("invalidates PII cached before account redaction", async () => {
			supabase.rpc.mockResolvedValue({ data: { preservedGames: 3 }, error: null });

			await userModel.anonymizeUser(ME);

			expect(supabase.rpc).toHaveBeenCalledWith("anonymize_user_data", {
				p_wallet_address: ME,
			});
			expect(redis.del).toHaveBeenCalledWith(`cache:profile:${ME}`);
		});

		it("invalidates cached profile totals after a puzzle reward", async () => {
			supabase.rpc.mockResolvedValue({ data: { awarded: true, points: 10 }, error: null });

			await userModel.recordPuzzleSolve(ME, "puzzle-id", "2026-09-25", 10);

			expect(redis.del).toHaveBeenCalledWith(`cache:profile:${ME}`);
		});
	});
});
