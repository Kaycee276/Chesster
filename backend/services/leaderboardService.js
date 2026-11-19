const db = require("../config/db");
const { queryWithRetry } = require("../config/db");
const { getRedisClient } = require("../config/redis");

const LEADERBOARD_CACHE_PREFIX = "chesster:leaderboard";
const LEADERBOARD_CACHE_KEY_TOP100 = "chesster:leaderboard:top100";
const LEADERBOARD_CACHE_TTL_SECONDS = 60;

// Sorted set of active players scored by ELO, used for O(log N) rank and
// percentile lookups (Issue #642).
const ACTIVE_PLAYERS_KEY = "leaderboard:active_players";
const ACTIVE_PLAYERS_TTL_SECONDS = 15 * 60;
const ZADD_CHUNK_SIZE = 1000;

class LeaderboardService {
	constructor({ database = db } = {}) {
		this.db = database;
		this.invalidateLeaderboardCache = this.invalidateLeaderboardCache.bind(this);
		this.invalidateCache = this.invalidateCache.bind(this);
		this.getLeaderboard = this.getLeaderboard.bind(this);
		this.getPlayerRankAndPercentile = this.getPlayerRankAndPercentile.bind(this);
		this.refreshLeaderboardCache = this.refreshLeaderboardCache.bind(this);
		this.refreshInFlight = null;
	}

	/** Percentile of a 1-based rank among `total` players, to one decimal, floored at 0.1. */
	static computePercentile(rank, total) {
		return Math.max(0.1, Number((((total - rank) / total) * 100).toFixed(1)));
	}

	/** Active (non-deleted) players with their ELO, straight from the database. */
	async fetchActivePlayerRatings() {
		if (this.db.prisma && this.db.prisma.player) {
			try {
				const players = await this.db.prisma.player.findMany({
					where: { is_deleted: false },
					select: { wallet_address: true, elo_rating: true },
				});
				return players.map((p) => ({ address: p.wallet_address, elo: p.elo_rating }));
			} catch (err) {
				console.warn(`[LeaderboardService] prisma ratings query failed: ${err.message}`);
			}
		}
		if (this.db.from) {
			const { data, error } = await this.db
				.from("players")
				.select("wallet_address, elo_rating")
				.eq("is_deleted", false);
			if (error) throw error;
			return (data || []).map((p) => ({ address: p.wallet_address, elo: p.elo_rating }));
		}
		return [];
	}

	/**
	 * Rebuild the `leaderboard:active_players` sorted set from the database with
	 * a 15 minute TTL. The new set is built under a temporary key and swapped in
	 * atomically so readers never see a partial leaderboard. Concurrent callers
	 * share a single rebuild.
	 *
	 * @returns {Promise<number>} number of players cached (0 if Redis is unavailable)
	 */
	refreshLeaderboardCache() {
		if (this.refreshInFlight) return this.refreshInFlight;
		this.refreshInFlight = this._refreshLeaderboardCache().finally(() => {
			this.refreshInFlight = null;
		});
		return this.refreshInFlight;
	}

	async _refreshLeaderboardCache() {
		const redis = getRedisClient();
		if (!redis) return 0;
		const players = (await this.fetchActivePlayerRatings()).filter(
			(p) => p.address && Number.isFinite(Number(p.elo)),
		);
		const tmpKey = `${ACTIVE_PLAYERS_KEY}:building:${process.pid}`;
		try {
			const tx = redis.multi().del(tmpKey);
			for (let i = 0; i < players.length; i += ZADD_CHUNK_SIZE) {
				const args = [];
				for (const p of players.slice(i, i + ZADD_CHUNK_SIZE)) args.push(Number(p.elo), p.address);
				tx.zadd(tmpKey, ...args);
			}
			if (players.length === 0) {
				tx.del(ACTIVE_PLAYERS_KEY);
			} else {
				tx.rename(tmpKey, ACTIVE_PLAYERS_KEY).expire(ACTIVE_PLAYERS_KEY, ACTIVE_PLAYERS_TTL_SECONDS);
			}
			await tx.exec();
		} catch (err) {
			console.warn(`[LeaderboardService] Active player cache refresh failed: ${err.message}`);
			return 0;
		}
		return players.length;
	}

	/** Rank and percentile computed from the database, used when Redis is unavailable. */
	async getRankAndPercentileFromDb(walletAddress) {
		const players = await this.fetchActivePlayerRatings();
		const me = players.find((p) => p.address === walletAddress);
		if (!me) return { rank: null, percentile: null };
		const higher = players.filter((p) => p.elo > me.elo).length;
		const rank = higher + 1;
		return { rank, totalPlayers: players.length, percentile: LeaderboardService.computePercentile(rank, players.length) };
	}

	/**
	 * Rank and percentile of a player among active players, computed from the
	 * Redis sorted set with ZCARD/ZREVRANK (O(log N)). Players with equal ELO
	 * share the same rank. Falls back to PostgreSQL if Redis is unavailable.
	 *
	 * @param {string} walletAddress
	 * @returns {Promise<{ rank: number|null, totalPlayers?: number, percentile: number|null }>}
	 */
	async getPlayerRankAndPercentile(walletAddress) {
		if (!walletAddress) return { rank: null, percentile: null };
		const redis = getRedisClient();
		if (redis) {
			try {
				let total = await redis.zcard(ACTIVE_PLAYERS_KEY);
				if (!total) {
					await this.refreshLeaderboardCache();
					total = await redis.zcard(ACTIVE_PLAYERS_KEY);
				}
				if (!total) return { rank: null, percentile: null };

				const index = await redis.zrevrank(ACTIVE_PLAYERS_KEY, walletAddress);
				if (index === null || index === undefined) return { rank: null, percentile: null };

				// ZREVRANK orders tied scores arbitrarily; resolve ties to the best rank
				// so equal ratings always get the same percentile.
				const score = await redis.zscore(ACTIVE_PLAYERS_KEY, walletAddress);
				const higher = await redis.zcount(ACTIVE_PLAYERS_KEY, `(${score}`, "+inf");
				const rank = Number(higher) + 1;
				return { rank, totalPlayers: total, percentile: LeaderboardService.computePercentile(rank, total) };
			} catch (err) {
				console.warn(`[LeaderboardService] Redis rank lookup failed, using database: ${err.message}`);
			}
		}
		return this.getRankAndPercentileFromDb(walletAddress);
	}

	getCacheKey(category = "all", limit = 50, offset = 0) {
		if (limit === 100 && offset === 0 && (!category || category === "all")) {
			return LEADERBOARD_CACHE_KEY_TOP100;
		}
		return `${LEADERBOARD_CACHE_PREFIX}:${category || "all"}:${limit}:${offset}`;
	}

	async invalidateLeaderboardCache() {
		const redis = getRedisClient();
		if (!redis) return;
		try {
			const keys = await redis.keys(`${LEADERBOARD_CACHE_PREFIX}:*`);
			if (keys && keys.length > 0) {
				await redis.del(...keys);
			}
		} catch (err) {
			console.warn(`[LeaderboardService] Cache invalidation failed: ${err.message}`);
		}
	}

	async invalidateCache() {
		return this.invalidateLeaderboardCache();
	}

	async getFinishedGames(category) {
		if (this.db.prisma && this.db.prisma.game) {
			try {
				const where = { status: "finished" };
				if (category === "bullet") {
					where.OR = [
						{ time_control_seconds: { lt: 180 } },
						{ time_control_preset: "bullet" },
					];
				} else if (category === "blitz") {
					where.OR = [
						{ time_control_seconds: { gte: 180, lte: 600 } },
						{ time_control_preset: "blitz" },
					];
				} else if (category === "rapid") {
					where.OR = [
						{ time_control_seconds: { gt: 600 } },
						{ time_control_preset: "rapid" },
					];
				}

				return await this.db.prisma.game.findMany({
					where,
					select: {
						id: true,
						game_code: true,
						player_white_address: true,
						player_black_address: true,
						winner: true,
						wager_amount: true,
						time_control_seconds: true,
						time_control_preset: true,
						updated_at: true,
					},
				});
			} catch (err) {
				console.warn(`[LeaderboardService] prisma query failed: ${err.message}`);
			}
		}

		if (this.db.from) {
			try {
				let query = this.db.from("games").select("*").eq("status", "finished");
				const { data, error } = await query;
				if (!error && data) {
					let games = data;
					if (category === "bullet") {
						games = games.filter(
							(g) =>
								(g.time_control_seconds && g.time_control_seconds < 180) ||
								g.time_control_preset === "bullet",
						);
					} else if (category === "blitz") {
						games = games.filter(
							(g) =>
								(g.time_control_seconds &&
									g.time_control_seconds >= 180 &&
									g.time_control_seconds <= 600) ||
								g.time_control_preset === "blitz",
						);
					} else if (category === "rapid") {
						games = games.filter(
							(g) =>
								(g.time_control_seconds && g.time_control_seconds > 600) ||
								g.time_control_preset === "rapid",
						);
					}
					return games;
				}
			} catch (err) {
				console.warn(`[LeaderboardService] fallback query failed: ${err.message}`);
			}
		}
		return [];
	}

	async getPlayerProfiles(walletAddresses) {
		if (!walletAddresses || walletAddresses.length === 0) return new Map();

		const profileMap = new Map();

		if (this.db.prisma && this.db.prisma.user) {
			try {
				const users = await this.db.prisma.user.findMany({
					where: { wallet_address: { in: walletAddresses } },
					select: { wallet_address: true, username: true },
				});
				for (const u of users) {
					profileMap.set(u.wallet_address, { username: u.username });
				}
			} catch (_) {}
		}

		if (this.db.prisma && this.db.prisma.player) {
			try {
				const players = await this.db.prisma.player.findMany({
					where: { wallet_address: { in: walletAddresses } },
					select: { wallet_address: true, username: true, elo_rating: true },
				});
				for (const p of players) {
					const existing = profileMap.get(p.wallet_address) || {};
					profileMap.set(p.wallet_address, {
						username: p.username || existing.username,
						elo: p.elo_rating,
					});
				}
			} catch (_) {}
		}

		if (profileMap.size === 0 && this.db.from) {
			try {
				const { data } = await this.db
					.from("users")
					.select("wallet_address, username")
					.in("wallet_address", walletAddresses);
				for (const u of data || []) {
					profileMap.set(u.wallet_address, { username: u.username });
				}
			} catch (_) {}
		}

		return profileMap;
	}

	async getLeaderboard({ category = "all", limit = 50, offset = 0 } = {}) {
		const redis = getRedisClient();
		const cacheKey = this.getCacheKey(category, limit, offset);

		if (redis) {
			try {
				const cached = await redis.get(cacheKey);
				if (cached) {
					const parsed = JSON.parse(cached);
					Object.defineProperty(parsed, "_cacheHit", {
						value: true,
						writable: true,
						enumerable: false,
						configurable: true,
					});
					return parsed;
				}
			} catch (err) {
				console.warn(`[LeaderboardService] Redis cache read failed: ${err.message}`);
			}
		}

		const games = await this.getFinishedGames(category);
		const playerStats = new Map();

		function getPlayer(address) {
			if (!playerStats.has(address)) {
				playerStats.set(address, {
					address,
					username: null,
					elo: 1200,
					wins: 0,
					losses: 0,
					draws: 0,
					totalEarnings: 0,
				});
			}
			return playerStats.get(address);
		}

		for (const game of games) {
			const white = game.player_white_address;
			const black = game.player_black_address;
			if (!white && !black) continue;

			const wager = Number(game.wager_amount || 0);

			if (white && black) {
				const whiteStats = getPlayer(white);
				const blackStats = getPlayer(black);

				if (game.winner === "white") {
					whiteStats.wins += 1;
					whiteStats.totalEarnings += wager;
					blackStats.losses += 1;
				} else if (game.winner === "black") {
					blackStats.wins += 1;
					blackStats.totalEarnings += wager;
					whiteStats.losses += 1;
				} else if (game.winner === "draw") {
					whiteStats.draws += 1;
					blackStats.draws += 1;
				}
			} else if (white && !black) {
				const whiteStats = getPlayer(white);
				if (game.winner === "white") {
					whiteStats.wins += 1;
					whiteStats.totalEarnings += wager;
				} else if (game.winner === "black") {
					whiteStats.losses += 1;
				} else if (game.winner === "draw") {
					whiteStats.draws += 1;
				}
			} else if (!white && black) {
				const blackStats = getPlayer(black);
				if (game.winner === "black") {
					blackStats.wins += 1;
					blackStats.totalEarnings += wager;
				} else if (game.winner === "white") {
					blackStats.losses += 1;
				} else if (game.winner === "draw") {
					blackStats.draws += 1;
				}
			}
		}

		const wallets = Array.from(playerStats.keys());
		const profiles = await this.getPlayerProfiles(wallets);

		for (const p of playerStats.values()) {
			const profile = profiles.get(p.address);
			if (profile) {
				if (profile.username) p.username = profile.username;
				if (profile.elo != null) p.elo = profile.elo;
			}
			if (p.elo === 1200) {
				p.elo = Math.max(100, 1200 + p.wins * 16 - p.losses * 16);
			}
			const gamesPlayed = p.wins + p.losses + p.draws;
			p.winRate = gamesPlayed > 0 ? Number((p.wins / gamesPlayed).toFixed(4)) : 0;
			p.totalEarnings = Number(p.totalEarnings.toFixed(2));
		}

		const sorted = Array.from(playerStats.values()).sort((a, b) => {
			if (b.elo !== a.elo) return b.elo - a.elo;
			if (b.wins !== a.wins) return b.wins - a.wins;
			if (b.winRate !== a.winRate) return b.winRate - a.winRate;
			if (b.totalEarnings !== a.totalEarnings) return b.totalEarnings - a.totalEarnings;
			return a.address.localeCompare(b.address);
		});

		const ranked = sorted.map((entry, index) => ({
			rank: index + 1,
			address: entry.address,
			username: entry.username || null,
			elo: entry.elo,
			wins: entry.wins,
			losses: entry.losses,
			draws: entry.draws,
			winRate: entry.winRate,
			totalEarnings: entry.totalEarnings,
		}));

		const result = ranked.slice(offset, offset + limit);

		if (redis) {
			try {
				await redis.setex(cacheKey, LEADERBOARD_CACHE_TTL_SECONDS, JSON.stringify(result));
			} catch (err) {
				console.warn(`[LeaderboardService] Redis cache write failed: ${err.message}`);
			}
		}

		Object.defineProperty(result, "_cacheHit", {
			value: false,
			writable: true,
			enumerable: false,
			configurable: true,
		});

		return result;
	}

	async syncPlayerStats(game) {
		if (!game || game.status !== "finished") return;
		const wallets = [game.player_white_address, game.player_black_address].filter(Boolean);
		if (wallets.length === 0) return;

		if (this.db.prisma && this.db.prisma.playerStats) {
			try {
				for (const address of wallets) {
					const games = await this.db.prisma.game.findMany({
						where: {
							status: "finished",
							OR: [
								{ player_white_address: address },
								{ player_black_address: address },
							],
						},
						select: {
							player_white_address: true,
							player_black_address: true,
							winner: true,
						},
					});

					let wins = 0;
					let losses = 0;
					let draws = 0;

					for (const g of games) {
						const isWhite = g.player_white_address === address;
						if (g.winner === (isWhite ? "white" : "black")) wins += 1;
						else if (g.winner === (isWhite ? "black" : "white")) losses += 1;
						else if (g.winner === "draw") draws += 1;
					}

					const gamesPlayed = wins + losses + draws;

					await this.db.prisma.playerStats.upsert({
						where: { wallet_address: address },
						create: {
							wallet_address: address,
							wins,
							losses,
							draws,
							games_played: gamesPlayed,
						},
						update: {
							wins,
							losses,
							draws,
							games_played: gamesPlayed,
							updated_at: new Date(),
						},
					});
				}
			} catch (err) {
				console.warn(`[LeaderboardService] Failed to sync playerStats: ${err.message}`);
			}
		}

		await this.invalidateCache();
	}
}

const leaderboardServiceInstance = new LeaderboardService();

module.exports = leaderboardServiceInstance;
module.exports.LeaderboardService = LeaderboardService;
module.exports.invalidateLeaderboardCache = leaderboardServiceInstance.invalidateLeaderboardCache;
