const BACKEND_URL =
	import.meta.env.VITE_BACKEND_URL || "http://localhost:3000/";
const API_URL = `${BACKEND_URL}api`;

/** A single ranked player as returned by the leaderboard endpoint. */
export interface LeaderboardEntry {
	rank: number;
	/** Stellar address of the player. */
	address: string;
	/** Optional display name; falls back to a shortened address in the UI. */
	username?: string | null;
	elo: number;
	wins: number;
	losses: number;
	draws: number;
	/** Fraction in [0, 1]; the UI renders it as a percentage. */
	winRate: number;
	/** Total XLM won across settled wagered games. */
	totalEarnings: number;
}

/** Standard backend JSON envelope, shared with gameApi/tournamentApi responses. */
interface LeaderboardResponse {
	success?: boolean;
	data?: LeaderboardEntry[];
	message?: string;
}

/**
 * Fetch the global leaderboard, ranked by the backend.
 *
 * Throws on network failure or a non-OK response so callers can render an
 * error state; returns an empty array when the backend reports no players.
 */
export async function getLeaderboard(): Promise<LeaderboardEntry[]> {
	const res = await fetch(`${API_URL}/leaderboard`);
	if (!res.ok) {
		throw new Error(`Leaderboard request failed with status ${res.status}`);
	}
	const body: LeaderboardResponse = await res.json();
	return Array.isArray(body.data) ? body.data : [];
}
