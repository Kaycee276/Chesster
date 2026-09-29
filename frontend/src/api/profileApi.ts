const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:3000/";
const API_URL = `${BACKEND_URL}api`;

export const GAME_MODES = ["bullet", "blitz", "rapid", "tournament"] as const;
export type GameMode = (typeof GAME_MODES)[number];
export type GameResult = "win" | "loss" | "draw";

export interface RatingPoint {
	/** ISO timestamp of the rated game. */
	date: string;
	rating: number;
	gameCode?: string | null;
}

export interface RecordStats {
	games: number;
	wins: number;
	draws: number;
	losses: number;
}

export interface ModeStats extends RecordStats {
	rating: number | null;
	ratingHistory: RatingPoint[];
}

export interface RecentGame {
	gameCode: string;
	opponentAddress: string | null;
	opponentName: string | null;
	result: GameResult;
	mode: GameMode | null;
	/** "white" | "black" from the profile owner's perspective. */
	color: "white" | "black" | null;
	ratingChange: number | null;
	playedAt: string | null;
}

export interface PlayerProfile {
	address: string;
	username: string | null;
	avatarUrl: string | null;
	rating: number | null;
	stats: RecordStats;
	modes: Partial<Record<GameMode, ModeStats>>;
	ratingHistory: RatingPoint[];
	recentGames: RecentGame[];
}

/** Thrown when the backend has no profile for the requested address. */
export class ProfileNotFoundError extends Error {
	constructor(address: string) {
		super(`No profile found for ${address}`);
		this.name = "ProfileNotFoundError";
	}
}

// ── Normalisation ─────────────────────────────────────────────────────────────
// The profile endpoint may return camelCase or the snake_case column names used
// elsewhere in the backend; normalise both into the PlayerProfile shape.

type Raw = Record<string, unknown>;

const isObject = (value: unknown): value is Raw =>
	typeof value === "object" && value !== null && !Array.isArray(value);

function pick(raw: Raw, ...keys: string[]): unknown {
	for (const key of keys) {
		if (raw[key] !== undefined && raw[key] !== null) return raw[key];
	}
	return undefined;
}

function toNumber(value: unknown): number | null {
	const n = typeof value === "string" ? Number(value) : value;
	return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function toCount(value: unknown): number {
	const n = toNumber(value);
	return n !== null && n > 0 ? Math.floor(n) : 0;
}

function toStringOrNull(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function toMode(value: unknown): GameMode | null {
	const mode = typeof value === "string" ? value.toLowerCase() : "";
	return (GAME_MODES as readonly string[]).includes(mode) ? (mode as GameMode) : null;
}

function toResult(value: unknown): GameResult | null {
	const result = typeof value === "string" ? value.toLowerCase() : "";
	if (result === "win" || result === "won" || result === "w") return "win";
	if (result === "loss" || result === "lost" || result === "l") return "loss";
	if (result === "draw" || result === "d") return "draw";
	return null;
}

function normalizeRecord(raw: Raw): RecordStats {
	const wins = toCount(pick(raw, "wins"));
	const draws = toCount(pick(raw, "draws"));
	const losses = toCount(pick(raw, "losses"));
	const games = toCount(pick(raw, "games", "totalGames", "total_games", "gamesPlayed", "games_played"));
	return { wins, draws, losses, games: Math.max(games, wins + draws + losses) };
}

function normalizeHistory(value: unknown): RatingPoint[] {
	if (!Array.isArray(value)) return [];
	const points: RatingPoint[] = [];
	for (const entry of value) {
		if (!isObject(entry)) continue;
		const rating = toNumber(pick(entry, "rating", "elo", "elo_rating", "ratingAfter", "rating_after"));
		const date = toStringOrNull(pick(entry, "date", "playedAt", "played_at", "created_at", "createdAt"));
		if (rating === null || date === null || Number.isNaN(Date.parse(date))) continue;
		points.push({
			rating,
			date,
			gameCode: toStringOrNull(pick(entry, "gameCode", "game_code")),
		});
	}
	return points.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

function normalizeRecentGame(raw: Raw): RecentGame | null {
	const gameCode = toStringOrNull(pick(raw, "gameCode", "game_code"));
	const result = toResult(pick(raw, "result", "outcome"));
	if (!gameCode || !result) return null;

	const color = pick(raw, "color", "playerColor", "player_color");
	return {
		gameCode,
		result,
		opponentAddress: toStringOrNull(pick(raw, "opponentAddress", "opponent_address", "opponent")),
		opponentName: toStringOrNull(pick(raw, "opponentName", "opponent_name", "opponentUsername", "opponent_username")),
		mode: toMode(pick(raw, "mode", "gameMode", "game_mode", "timeControl", "time_control_preset")),
		color: color === "white" || color === "black" ? color : null,
		ratingChange: toNumber(pick(raw, "ratingChange", "rating_change", "eloChange", "elo_change")),
		playedAt: toStringOrNull(pick(raw, "playedAt", "played_at", "endedAt", "ended_at", "created_at", "createdAt")),
	};
}

/**
 * Converts an API payload into a PlayerProfile, tolerating missing sections
 * and either camelCase or snake_case keys.
 */
export function normalizeProfile(raw: unknown, fallbackAddress: string): PlayerProfile {
	const data = isObject(raw) ? raw : {};
	const stats = pick(data, "stats", "record");

	const modes: Partial<Record<GameMode, ModeStats>> = {};
	const rawModes = pick(data, "modes", "modeStats", "mode_stats");
	if (isObject(rawModes)) {
		for (const mode of GAME_MODES) {
			const entry = rawModes[mode];
			if (!isObject(entry)) continue;
			modes[mode] = {
				...normalizeRecord(entry),
				rating: toNumber(pick(entry, "rating", "elo", "elo_rating")),
				ratingHistory: normalizeHistory(pick(entry, "ratingHistory", "rating_history", "history")),
			};
		}
	}

	const rawGames = pick(data, "recentGames", "recent_games", "matches");
	const recentGames = Array.isArray(rawGames)
		? rawGames.flatMap((g) => {
				const game = isObject(g) ? normalizeRecentGame(g) : null;
				return game ? [game] : [];
			})
		: [];

	return {
		address: toStringOrNull(pick(data, "address", "walletAddress", "wallet_address")) ?? fallbackAddress,
		username: toStringOrNull(pick(data, "username", "displayName", "display_name")),
		avatarUrl: toStringOrNull(pick(data, "avatarUrl", "avatar_url")),
		rating: toNumber(pick(data, "rating", "elo", "eloRating", "elo_rating")),
		stats: normalizeRecord(isObject(stats) ? stats : data),
		modes,
		ratingHistory: normalizeHistory(pick(data, "ratingHistory", "rating_history")),
		recentGames,
	};
}

/**
 * Fetches a player's public profile from `GET /api/users/:address/profile`.
 * @throws ProfileNotFoundError when the address has no profile.
 */
export async function fetchPlayerProfile(address: string, signal?: AbortSignal): Promise<PlayerProfile> {
	const res = await fetch(`${API_URL}/users/${encodeURIComponent(address)}/profile`, { signal });
	if (res.status === 404) throw new ProfileNotFoundError(address);

	let json: { success?: boolean; data?: unknown; error?: string } | null = null;
	try {
		json = await res.json();
	} catch {
		// Non-JSON body; handled below.
	}

	if (!res.ok || !json || json.success === false) {
		throw new Error(json?.error || `Failed to load profile (HTTP ${res.status})`);
	}

	return normalizeProfile(json.data ?? json, address);
}
