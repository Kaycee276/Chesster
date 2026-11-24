const supabase = require("../config/supabase");
const { getRedisClient } = require("../config/redis");

const VOLUME_24H_CACHE_KEY = "analytics:volume-24h";
const VOLUME_24H_CACHE_TTL_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// In-memory fallback used when Redis is disabled or unavailable.
let volumeMemoryCache = null; // { expiresAt, value }

/**
 * Get the count of unique active players for a given date.
 * A player is considered active if they were player_white or player_black
 * in a game that existed on that date.
 */
async function getDailyActivePlayers(date) {
	try {
		const startOfDay = new Date(date);
		startOfDay.setUTCHours(0, 0, 0, 0);
		const endOfDay = new Date(date);
		endOfDay.setUTCHours(23, 59, 59, 999);

		const { data: whitePlayers, error: whiteError } = await supabase
			.from("games")
			.select("player_white_address")
			.not("player_white_address", "is", null)
			.gte("created_at", startOfDay.toISOString())
			.lte("created_at", endOfDay.toISOString());

		if (whiteError) throw whiteError;

		const { data: blackPlayers, error: blackError } = await supabase
			.from("games")
			.select("player_black_address")
			.not("player_black_address", "is", null)
			.gte("created_at", startOfDay.toISOString())
			.lte("created_at", endOfDay.toISOString());

		if (blackError) throw blackError;

		const wallets = new Set();
		for (const row of whitePlayers || []) {
			if (row.player_white_address) wallets.add(row.player_white_address);
		}
		for (const row of blackPlayers || []) {
			if (row.player_black_address) wallets.add(row.player_black_address);
		}

		return { date: startOfDay.toISOString().split("T")[0], activePlayers: wallets.size };
	} catch (error) {
		console.error("[AnalyticsService] Error fetching daily active players:", error.message);
		throw error;
	}
}

/**
 * Get match volume stats for a given date: total matches, completed, wins, draws.
 */
async function getDailyMatchVolume(date) {
	try {
		const startOfDay = new Date(date);
		startOfDay.setUTCHours(0, 0, 0, 0);
		const endOfDay = new Date(date);
		endOfDay.setUTCHours(23, 59, 59, 999);

		const { data: matches, error } = await supabase
			.from("games")
			.select("status, winner")
			.gte("created_at", startOfDay.toISOString())
			.lte("created_at", endOfDay.toISOString());

		if (error) throw error;

		const all = matches || [];
		const completed = all.filter((m) => m.status === "completed");
		const draws = completed.filter((m) => !m.winner || m.winner === null);
		const wins = completed.filter((m) => m.winner && m.winner !== null);

		return {
			date: startOfDay.toISOString().split("T")[0],
			totalMatches: all.length,
			completedMatches: completed.length,
			wins: wins.length,
			draws: draws.length,
		};
	} catch (error) {
		console.error("[AnalyticsService] Error fetching daily match volume:", error.message);
		throw error;
	}
}

/**
 * Get total tokens wagered for a given date.
 */
async function getTokenWageredSummary(date) {
	try {
		const startOfDay = new Date(date);
		startOfDay.setUTCHours(0, 0, 0, 0);
		const endOfDay = new Date(date);
		endOfDay.setUTCHours(23, 59, 59, 999);

		const { data: matches, error } = await supabase
			.from("games")
			.select("wager_amount, status")
			.gte("created_at", startOfDay.toISOString())
			.lte("created_at", endOfDay.toISOString())
			.not("wager_amount", "is", null);

		if (error) throw error;

		const all = matches || [];
		let totalWagered = 0;
		let completedWagered = 0;

		for (const match of all) {
			const amount = parseFloat(match.wager_amount) || 0;
			totalWagered += amount;
			if (match.status === "completed") {
				completedWagered += amount;
			}
		}

		return {
			date: startOfDay.toISOString().split("T")[0],
			totalWagered: totalWagered.toFixed(7),
			completedWagered: completedWagered.toFixed(7),
			matchesWithWager: all.length,
		};
	} catch (error) {
		console.error("[AnalyticsService] Error fetching token wagered summary:", error.message);
		throw error;
	}
}

/**
 * Get a combined dashboard summary for a date range.
 * If dateRange is not provided, defaults to the last 7 days.
 */
async function getDashboardSummary(dateRange = null) {
	try {
		const end = dateRange?.end ? new Date(dateRange.end) : new Date();
		const start = dateRange?.start
			? new Date(dateRange.start)
			: new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);

		start.setUTCHours(0, 0, 0, 0);
		end.setUTCHours(23, 59, 59, 999);

		const { data: matches, error } = await supabase
			.from("games")
			.select("status, winner, wager_amount, player_white_address, player_black_address, created_at")
			.gte("created_at", start.toISOString())
			.lte("created_at", end.toISOString());

		if (error) throw error;

		const all = matches || [];
		const wallets = new Set();
		let totalWagered = 0;
		let completedMatches = 0;
		let wins = 0;
		let draws = 0;

		for (const match of all) {
			if (match.player_white_address) wallets.add(match.player_white_address);
			if (match.player_black_address) wallets.add(match.player_black_address);

			const amount = parseFloat(match.wager_amount) || 0;
			totalWagered += amount;

			if (match.status === "completed") {
				completedMatches++;
				if (match.winner) wins++;
				else draws++;
			}
		}

		return {
			startDate: start.toISOString().split("T")[0],
			endDate: end.toISOString().split("T")[0],
			totalMatches: all.length,
			completedMatches,
			wins,
			draws,
			activePlayers: wallets.size,
			totalWagered: totalWagered.toFixed(7),
		};
	} catch (error) {
		console.error("[AnalyticsService] Error fetching dashboard summary:", error.message);
		throw error;
	}
}

/**
 * Aggregate hourly platform metrics from games table and store in hourly_platform_metrics.
 * This function is idempotent: calling it multiple times for the same hour will not create duplicates.
 *
 * Computes:
 * - total_matches: count of all games created in the hour
 * - completed_matches: count of games with status='completed'
 * - total_wager_xlm: sum of wager_amount for games (assumes XLM token)
 * - total_wager_usdc: sum of wager_amount for games (filtered by token_address, assumes USDC token)
 * - unique_players: count of distinct wallet addresses (player_white_address or player_black_address)
 *
 * @param {Date|string} targetHour - The hour to aggregate. Can be a Date object or ISO string.
 *                                   The function will truncate to the hour boundary (e.g., 14:00:00).
 * @returns {object} Result object with aggregation stats: { bucketStart, rowsInserted, aggregatedMetrics }
 * @throws {Error} If database query or upsert fails
 */
async function aggregateHourlyMetrics(targetHour) {
	try {
		// Normalize input and truncate to hour boundary
		const hourDate = new Date(targetHour);
		hourDate.setUTCMinutes(0, 0, 0);
		const bucketStart = hourDate.toISOString();
		const bucketEnd = new Date(hourDate.getTime() + 60 * 60 * 1000).toISOString();

		// Query all games created within this hour
		const { data: games, error: gamesError } = await supabase
			.from("games")
			.select("status, winner, wager_amount, token_address, player_white_address, player_black_address")
			.gte("created_at", bucketStart)
			.lt("created_at", bucketEnd);

		if (gamesError) throw gamesError;

		const gamesList = games || [];
		const wallets = new Set();
		let totalMatches = 0;
		let completedMatches = 0;
		let totalWagerXlm = 0;
		let totalWagerUsdc = 0;

		// Process games and aggregate metrics
		for (const game of gamesList) {
			totalMatches++;

			// Collect unique players
			if (game.player_white_address) wallets.add(game.player_white_address);
			if (game.player_black_address) wallets.add(game.player_black_address);

			// Count completed matches
			if (game.status === "completed") {
				completedMatches++;
			}

			// Aggregate wager amounts by token type
			const wagerAmount = parseFloat(game.wager_amount) || 0;
			if (wagerAmount > 0) {
				// Determine token type from token_address if available, otherwise assume XLM
				// This can be enhanced with token type detection if token_address is provided
				if (game.token_address && game.token_address.toLowerCase().includes("usdc")) {
					totalWagerUsdc += wagerAmount;
				} else {
					totalWagerXlm += wagerAmount;
				}
			}
		}

		// Upsert metrics into hourly_platform_metrics table
		// ON CONFLICT on bucket_start, update the metrics (idempotent)
		const { data: upsertResult, error: upsertError } = await supabase
			.from("hourly_platform_metrics")
			.upsert(
				{
					bucket_start: bucketStart,
					total_matches: totalMatches,
					completed_matches: completedMatches,
					total_wager_xlm: totalWagerXlm.toFixed(7),
					total_wager_usdc: totalWagerUsdc.toFixed(2),
					unique_players: wallets.size,
				},
				{
					onConflict: "bucket_start",
				}
			)
			.select();

		if (upsertError) throw upsertError;

		console.log(
			`[AnalyticsService] Aggregated hourly metrics for ${bucketStart}: ` +
				`${totalMatches} matches, ${completedMatches} completed, ` +
				`${wallets.size} unique players, XLM: ${totalWagerXlm.toFixed(7)}, USDC: ${totalWagerUsdc.toFixed(2)}`
		);

		return {
			bucketStart,
			rowsInserted: upsertResult?.length || 1,
			aggregatedMetrics: {
				totalMatches,
				completedMatches,
				uniquePlayers: wallets.size,
				totalWagerXlm: parseFloat(totalWagerXlm.toFixed(7)),
				totalWagerUsdc: parseFloat(totalWagerUsdc.toFixed(2)),
			},
		};
	} catch (error) {
		console.error("[AnalyticsService] Error aggregating hourly metrics:", error.message);
		throw error;
	}
}

/**
 * Resolve the asset symbol for a game's token_address. Games without a token
 * address are wagered in native XLM. USDC/EURC are matched against the
 * configured issuer/contract addresses (USDC_TOKEN_ADDRESS, EURC_TOKEN_ADDRESS)
 * and, as a fallback, against the symbol embedded in the address string.
 * Unrecognised tokens are reported under their raw address.
 */
function resolveAssetSymbol(tokenAddress) {
	if (!tokenAddress || typeof tokenAddress !== "string") return "XLM";
	const normalized = tokenAddress.trim();
	if (!normalized) return "XLM";
	const lower = normalized.toLowerCase();

	const configured = {
		USDC: process.env.USDC_TOKEN_ADDRESS,
		EURC: process.env.EURC_TOKEN_ADDRESS,
	};
	for (const [symbol, address] of Object.entries(configured)) {
		if (address && address.trim().toLowerCase() === lower) return symbol;
	}
	if (lower === "xlm" || lower === "native") return "XLM";
	if (lower.includes("usdc")) return "USDC";
	if (lower.includes("eurc")) return "EURC";
	return normalized;
}

function formatVolume(total, symbol) {
	const decimals = symbol === "USDC" || symbol === "EURC" ? 2 : 7;
	return total.toFixed(decimals);
}

async function readVolumeCache() {
	const redis = getRedisClient();
	if (redis) {
		try {
			const raw = await redis.get(VOLUME_24H_CACHE_KEY);
			if (raw) return JSON.parse(raw);
		} catch (err) {
			console.warn("[AnalyticsService] Redis read failed for volume cache:", err.message);
		}
	}
	if (volumeMemoryCache && volumeMemoryCache.expiresAt > Date.now()) {
		return volumeMemoryCache.value;
	}
	return null;
}

async function writeVolumeCache(value) {
	volumeMemoryCache = { expiresAt: Date.now() + VOLUME_24H_CACHE_TTL_MS, value };
	const redis = getRedisClient();
	if (redis) {
		try {
			await redis.set(VOLUME_24H_CACHE_KEY, JSON.stringify(value), "PX", VOLUME_24H_CACHE_TTL_MS);
		} catch (err) {
			console.warn("[AnalyticsService] Redis write failed for volume cache:", err.message);
		}
	}
}

/** Drop the cached 24-hour volume so the next call recomputes it. */
async function invalidateRolling24HourVolumeCache() {
	volumeMemoryCache = null;
	const redis = getRedisClient();
	if (redis) {
		try {
			await redis.del(VOLUME_24H_CACHE_KEY);
		} catch (err) {
			console.warn("[AnalyticsService] Redis delete failed for volume cache:", err.message);
		}
	}
}

/**
 * Aggregate wager volume for the trailing 24 hours, grouped by asset.
 * Results are cached for 5 minutes (Redis, with an in-memory fallback).
 *
 * @param {object} [options]
 * @param {boolean} [options.bypassCache=false] - recompute and refresh the cache
 * @returns {Promise<{window: string, timestamp: string, assets: Array}>}
 */
async function getRolling24HourVolume({ bypassCache = false } = {}) {
	if (!bypassCache) {
		const cached = await readVolumeCache();
		if (cached) return cached;
	}

	try {
		const since = new Date(Date.now() - DAY_MS).toISOString();
		const { data: games, error } = await supabase
			.from("games")
			.select("wager_amount, token_address, player_white_address, player_black_address")
			.gte("created_at", since);

		if (error) throw error;

		const groups = new Map();
		for (const game of games || []) {
			const symbol = resolveAssetSymbol(game.token_address);
			let group = groups.get(symbol);
			if (!group) {
				group = { total: 0, matchCount: 0, players: new Set() };
				groups.set(symbol, group);
			}
			group.total += parseFloat(game.wager_amount) || 0;
			group.matchCount++;
			if (game.player_white_address) group.players.add(game.player_white_address);
			if (game.player_black_address) group.players.add(game.player_black_address);
		}

		const assets = [...groups.entries()]
			.map(([asset, g]) => ({
				asset,
				totalVolume: formatVolume(g.total, asset),
				matchCount: g.matchCount,
				uniquePlayers: g.players.size,
				averageWager: formatVolume(g.matchCount ? g.total / g.matchCount : 0, asset),
			}))
			.sort((a, b) => a.asset.localeCompare(b.asset));

		const result = { window: "24h", timestamp: new Date().toISOString(), assets };
		await writeVolumeCache(result);
		return result;
	} catch (error) {
		console.error("[AnalyticsService] Error fetching rolling 24-hour volume:", error.message);
		throw error;
	}
}

module.exports = {
	getDailyActivePlayers,
	getDailyMatchVolume,
	getTokenWageredSummary,
	getDashboardSummary,
	aggregateHourlyMetrics,
	getRolling24HourVolume,
	invalidateRolling24HourVolumeCache,
	resolveAssetSymbol,
};
