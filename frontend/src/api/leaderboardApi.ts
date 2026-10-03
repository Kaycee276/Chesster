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
 * Time-control buckets the leaderboard can be filtered by (#316).
 * "all" is a UI-only value: the request is sent without a category param.
 */
export type LeaderboardCategory = "bullet" | "blitz" | "rapid" | "all";

/**
 * Fetch the global leaderboard, ranked by the backend.
 *
 * `category` narrows results to a time-control bucket (bullet/blitz/rapid);
 * when omitted or "all" the unfiltered global ranking is requested. The
 * backend may not support the parameter yet — the UI degrades gracefully.
 *
 * Throws on network failure or a non-OK response so callers can render an
 * error state; returns an empty array when the backend reports no players.
 */
export async function getLeaderboard(
	category?: LeaderboardCategory,
): Promise<LeaderboardEntry[]> {
	const qs = category && category !== "all" ? `?category=${category}` : "";
	const res = await fetch(`${API_URL}/leaderboard${qs}`);
	if (!res.ok) {
		throw new Error(`Leaderboard request failed with status ${res.status}`);
	}
	const body: LeaderboardResponse = await res.json();
	return Array.isArray(body.data) ? body.data : [];
}
