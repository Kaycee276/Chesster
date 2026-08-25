const supabase = require("../config/supabase");

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

module.exports = {
	getDailyActivePlayers,
	getDailyMatchVolume,
	getTokenWageredSummary,
	getDashboardSummary,
};
