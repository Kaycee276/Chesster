import type {
	GameMode,
	PlayerProfile,
	RatingPoint,
	RecentGame,
	RecordStats,
} from "../api/profileApi";

export type ProfileTab = "all" | GameMode;

export const PROFILE_TABS: { key: ProfileTab; label: string }[] = [
	{ key: "all", label: "All" },
	{ key: "bullet", label: "Bullet" },
	{ key: "blitz", label: "Blitz" },
	{ key: "rapid", label: "Rapid" },
	{ key: "tournament", label: "Tournament" },
];

export const RECENT_GAMES_LIMIT = 10;

export interface OpeningStat {
	name: string;
	eco: string | null;
	total: number;
	wins: number;
	losses: number;
	draws: number;
	winRate: number;
}

export interface ProfileView {
	stats: RecordStats;
	rating: number | null;
	ratingHistory: RatingPoint[];
	recentGames: RecentGame[];
	openingStats: OpeningStat[];
	openingSampleSize: number;
}

const EMPTY_STATS: RecordStats = { games: 0, wins: 0, draws: 0, losses: 0 };

function completedGame(game: RecentGame): boolean {
	const status = game.status?.toLowerCase();
	return (status === undefined || status === "finished" || status === "completed") &&
		(game.result === "win" || game.result === "loss" || game.result === "draw");
}

/** Aggregate completed profile-owner results without mutating game records. */
export function calculateOpeningStats(games: readonly RecentGame[], limit = 5): OpeningStat[] {
	if (!Number.isFinite(limit) || limit < 1) return [];
	const groups = new Map<string, OpeningStat>();
	for (const game of games) {
		if (!completedGame(game)) continue;
		const name = game.openingName?.trim() || "Unknown Opening";
		const rawEco = game.openingEco?.trim().toUpperCase();
		const eco = rawEco && /^[A-E][0-9]{2}$/.test(rawEco) ? rawEco : null;
		const key = JSON.stringify([name.toLowerCase(), eco]);
		const previous = groups.get(key);
		const total = (previous?.total ?? 0) + 1;
		const wins = (previous?.wins ?? 0) + Number(game.result === "win");
		groups.set(key, {
			name: previous?.name ?? name, eco, total, wins,
			losses: (previous?.losses ?? 0) + Number(game.result === "loss"),
			draws: (previous?.draws ?? 0) + Number(game.result === "draw"),
			winRate: Math.round((wins / total) * 1000) / 10,
		});
	}
	return [...groups.values()].sort((a, b) =>
		b.total - a.total || a.name.localeCompare(b.name, "en") || (a.eco ?? "").localeCompare(b.eco ?? "", "en"))
		.slice(0, Math.floor(limit));
}

export const getTopOpenings = calculateOpeningStats;

/** Win rate as a percentage (0-100), or null when no games were played. */
export function winRate(stats: RecordStats): number | null {
	return stats.games > 0 ? (stats.wins / stats.games) * 100 : null;
}

export function formatWinRate(stats: RecordStats): string {
	const rate = winRate(stats);
	if (rate === null) return "–";
	return `${Number.isInteger(rate) ? rate : rate.toFixed(1)}%`;
}

/** Stats, rating, history and the latest games for the selected mode tab. */
export function getProfileView(profile: PlayerProfile, tab: ProfileTab): ProfileView {
	const games = profile.recentGames.filter((game) => tab === "all" || game.mode === tab);
	const openingView = {
		openingStats: calculateOpeningStats(games),
		openingSampleSize: games.filter(completedGame).length,
	};
	if (tab === "all") {
		return {
			stats: profile.stats,
			rating: profile.rating,
			ratingHistory: profile.ratingHistory,
			recentGames: games.slice(0, RECENT_GAMES_LIMIT),
			...openingView,
		};
	}

	const mode = profile.modes[tab];
	return {
		stats: mode ?? EMPTY_STATS,
		rating: mode?.rating ?? null,
		ratingHistory: mode?.ratingHistory ?? [],
		recentGames: games.slice(0, RECENT_GAMES_LIMIT),
		...openingView,
	};
}

export const shortenAddress = (address: string) =>
	address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
