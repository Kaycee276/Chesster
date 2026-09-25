const supabase = require("../config/supabase");
const { getRedisClient } = require("../config/redis");

// Profiles only change when a match ends or the owner edits them, so they
// are cached for 10 minutes and explicitly invalidated on those events.
const PROFILE_CACHE_TTL_SECONDS = 600;
const RECENT_MATCHES_LIMIT = 10;
const RECENT_MATCH_COLUMNS =
	"game_code, status, winner, end_reason, player_white_address, player_black_address, wager_amount, move_count, created_at, updated_at";

function profileCacheKey(address) {
	return `cache:profile:${address}`;
}

function percentage(part, total) {
	return total > 0 ? Math.round((part / total) * 1000) / 10 : 0;
}

/** Summarise a finished game from `address`'s point of view. */
function toRecentMatch(game, address) {
	const color = game.player_white_address === address ? "white" : "black";
	let result = "draw";
	if (game.winner === color) result = "win";
	else if (game.winner === "white" || game.winner === "black") result = "loss";

	return {
		gameCode: game.game_code,
		color,
		opponent: color === "white" ? game.player_black_address : game.player_white_address,
		result,
		endReason: game.end_reason || null,
		wagerAmount: game.wager_amount ?? null,
		moveCount: game.move_count ?? 0,
		endedAt: game.updated_at || game.created_at || null,
	};
}

/**
 * UserModel — Supabase-backed storage for player profiles.
 * A "user" is identified by their Stellar wallet address (same address used
 * for game participation / escrow), so no separate signup/password flow is
 * required — see authService.js for the challenge/signature login flow that
 * proves ownership of the address before a profile can be read or edited.
 */
class UserModel {
	/**
	 * Fetch a user profile by wallet address, creating a default row the
	 * first time that address is seen (e.g. right after a successful login).
	 */
	async findOrCreateByAddress(address) {
		const { data: existing, error: fetchError } = await supabase
			.from("users")
			.select("*")
			.eq("wallet_address", address)
			.maybeSingle();

		if (fetchError) throw fetchError;
		if (existing) return existing;

		const { data, error } = await supabase
			.from("users")
			.insert({
				wallet_address: address,
				username: address.slice(0, 8),
			})
			.select()
			.single();

		if (error) throw error;
		return data;
	}

	/**
	 * Public profile with aggregated match statistics and recent matches,
	 * served from Redis (`cache:profile:<address>`) when possible. Any Redis
	 * failure silently falls back to PostgreSQL. Returns null if no such user.
	 */
	async getUserProfile(address) {
		const redis = getRedisClient();
		const key = profileCacheKey(address);

		if (redis) {
			try {
				const cached = await redis.get(key);
				if (cached) return JSON.parse(cached);
			} catch (err) {
				console.warn(`[UserModel] profile cache read failed for ${address}: ${err.message}`);
			}
		}

		const profile = await this.fetchProfileFromDB(address);

		if (redis && profile) {
			try {
				await redis.setex(key, PROFILE_CACHE_TTL_SECONDS, JSON.stringify(profile));
			} catch (err) {
				console.warn(`[UserModel] profile cache write failed for ${address}: ${err.message}`);
			}
		}
		return profile;
	}

	/** Build a profile straight from the database (no cache). */
	async fetchProfileFromDB(address) {
		const matchesAs = (column) =>
			supabase
				.from("games")
				.select(RECENT_MATCH_COLUMNS)
				.eq(column, address)
				.eq("status", "finished")
				.order("updated_at", { ascending: false })
				.limit(RECENT_MATCHES_LIMIT);

		const [userResult, statsResult, asWhite, asBlack] = await Promise.all([
			supabase.from("users").select("*").eq("wallet_address", address).maybeSingle(),
			supabase.from("player_stats").select("*").eq("wallet_address", address).maybeSingle(),
			matchesAs("player_white_address"),
			matchesAs("player_black_address"),
		]);

		for (const { error } of [userResult, statsResult, asWhite, asBlack]) {
			if (error) throw error;
		}
		const user = userResult.data;
		if (!user) return null;

		const stats = statsResult.data || {};
		const wins = stats.wins || 0;
		const losses = stats.losses || 0;
		const draws = stats.draws || 0;
		const gamesPlayed = stats.games_played || wins + losses + draws;

		const recentMatches = [...(asWhite.data || []), ...(asBlack.data || [])]
			.sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")))
			.slice(0, RECENT_MATCHES_LIMIT)
			.map((game) => toRecentMatch(game, address));

		return {
			...user,
			rating: user.elo_rating ?? null,
			stats: {
				gamesPlayed,
				wins,
				losses,
				draws,
				winRate: percentage(wins, gamesPlayed),
				lossRate: percentage(losses, gamesPlayed),
				drawRate: percentage(draws, gamesPlayed),
			},
			recentMatches,
		};
	}

	/** Drop cached profiles. Never throws: a failed delete just waits out the TTL. */
	async invalidateProfileCache(...addresses) {
		const keys = [...new Set(addresses.filter(Boolean))].map(profileCacheKey);
		const redis = getRedisClient();
		if (!redis || keys.length === 0) return;
		try {
			await redis.del(...keys);
		} catch (err) {
			console.warn(`[UserModel] profile cache invalidation failed: ${err.message}`);
		}
	}

	/** Invalidate both players' profiles once a match has concluded. */
	async invalidateProfilesForGame(game) {
		if (!game || game.status !== "finished") return;
		await this.invalidateProfileCache(game.player_white_address, game.player_black_address);
	}

	async getByAddress(address) {
		const { data, error } = await supabase
			.from("users")
			.select("*")
			.eq("wallet_address", address)
			.maybeSingle();

		if (error) throw error;
		if (!data) throw new Error("Profile not found");
		return data;
	}

	/**
	 * Update customizable profile fields. Only a known allow-list of columns
	 * may be changed here so authenticated users can't overwrite internal
	 * bookkeeping columns (wallet_address, created_at, ...).
	 */
	async updateProfile(address, updates = {}) {
		const ALLOWED_FIELDS = ["username", "avatar_url", "bio", "country"];
		const sanitized = {};

		for (const field of ALLOWED_FIELDS) {
			if (updates[field] !== undefined) {
				sanitized[field] = String(updates[field]).slice(0, 280);
			}
		}

		if (Object.keys(sanitized).length === 0) {
			throw new Error("No valid profile fields to update");
		}

		if (sanitized.username !== undefined && sanitized.username.trim().length === 0) {
			throw new Error("Username cannot be empty");
		}

		const { data, error } = await supabase
			.from("users")
			.update(sanitized)
			.eq("wallet_address", address)
			.select()
			.single();

		if (error) throw error;
		if (!data) throw new Error("Profile not found");
		await this.invalidateProfileCache(address);
		return data;
	}

	/**
	 * Redact profile data and purge attributable communications in one database
	 * transaction. Historical games and their move rows are intentionally kept.
	 */
	async anonymizeUser(address) {
		const { data, error } = await supabase.rpc("anonymize_user_data", {
			p_wallet_address: address,
		});

		if (error) throw error;
		if (!data) throw new Error("Profile not found");
		await this.invalidateProfileCache(address);
		return data;
	}

	async recordPuzzleSolve(address, puzzleId, solvedOn, points = 10) {
		const { data, error } = await supabase.rpc("record_puzzle_solve", {
			p_wallet_address: address,
			p_puzzle_id: puzzleId,
			p_solved_on: solvedOn,
			p_points: points,
		});

		if (error) throw error;
		if (!data) throw new Error("Player profile not found");
		await this.invalidateProfileCache(address);
		return data;
	}
}

module.exports = new UserModel();
