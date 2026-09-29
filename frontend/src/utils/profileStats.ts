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

export interface ProfileView {
	stats: RecordStats;
	rating: number | null;
	ratingHistory: RatingPoint[];
	recentGames: RecentGame[];
}

const EMPTY_STATS: RecordStats = { games: 0, wins: 0, draws: 0, losses: 0 };

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
	if (tab === "all") {
		return {
			stats: profile.stats,
			rating: profile.rating,
			ratingHistory: profile.ratingHistory,
			recentGames: profile.recentGames.slice(0, RECENT_GAMES_LIMIT),
		};
	}

	const mode = profile.modes[tab];
	return {
		stats: mode ?? EMPTY_STATS,
		rating: mode?.rating ?? null,
		ratingHistory: mode?.ratingHistory ?? [],
		recentGames: profile.recentGames.filter((g) => g.mode === tab).slice(0, RECENT_GAMES_LIMIT),
	};
}

export const shortenAddress = (address: string) =>
	address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
