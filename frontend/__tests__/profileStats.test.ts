import { describe, it, expect } from "vitest";
import type { PlayerProfile, RecentGame } from "../src/api/profileApi";
import {
	RECENT_GAMES_LIMIT,
	formatWinRate,
	getProfileView,
	shortenAddress,
	winRate,
} from "../src/utils/profileStats";

const game = (gameCode: string, mode: RecentGame["mode"]): RecentGame => ({
	gameCode,
	mode,
	result: "win",
	opponentAddress: null,
	opponentName: null,
	color: null,
	ratingChange: null,
	playedAt: null,
});

const profile: PlayerProfile = {
	address: "GABC",
	username: null,
	avatarUrl: null,
	rating: 1500,
	stats: { games: 20, wins: 10, draws: 4, losses: 6 },
	modes: {
		blitz: {
			rating: 1450,
			games: 5,
			wins: 3,
			draws: 1,
			losses: 1,
			ratingHistory: [{ date: "2026-01-01T00:00:00Z", rating: 1450 }],
		},
	},
	ratingHistory: [{ date: "2026-01-01T00:00:00Z", rating: 1500 }],
	recentGames: [
		...Array.from({ length: 12 }, (_, i) => game(`R${i}`, "rapid")),
		game("B1", "blitz"),
		game("B2", "blitz"),
	],
};

describe("winRate / formatWinRate", () => {
	it("computes the percentage of games won", () => {
		expect(winRate({ games: 20, wins: 10, draws: 4, losses: 6 })).toBe(50);
		expect(formatWinRate({ games: 20, wins: 10, draws: 4, losses: 6 })).toBe("50%");
		expect(formatWinRate({ games: 3, wins: 1, draws: 1, losses: 1 })).toBe("33.3%");
	});

	it("shows a dash when no games were played", () => {
		expect(winRate({ games: 0, wins: 0, draws: 0, losses: 0 })).toBeNull();
		expect(formatWinRate({ games: 0, wins: 0, draws: 0, losses: 0 })).toBe("–");
	});
});

describe("getProfileView", () => {
	it("uses overall stats and the latest 10 games for the All tab", () => {
		const view = getProfileView(profile, "all");
		expect(view.stats).toBe(profile.stats);
		expect(view.rating).toBe(1500);
		expect(view.ratingHistory).toBe(profile.ratingHistory);
		expect(view.recentGames).toHaveLength(RECENT_GAMES_LIMIT);
		expect(view.recentGames[0].gameCode).toBe("R0");
	});

	it("uses per-mode stats and filters games by mode", () => {
		const view = getProfileView(profile, "blitz");
		expect(view.stats).toMatchObject({ games: 5, wins: 3 });
		expect(view.rating).toBe(1450);
		expect(view.ratingHistory).toHaveLength(1);
		expect(view.recentGames.map((g) => g.gameCode)).toEqual(["B1", "B2"]);
	});

	it("returns an empty view for a mode with no data", () => {
		const view = getProfileView(profile, "bullet");
		expect(view.stats).toEqual({ games: 0, wins: 0, draws: 0, losses: 0 });
		expect(view.rating).toBeNull();
		expect(view.ratingHistory).toEqual([]);
		expect(view.recentGames).toEqual([]);
	});
});

describe("shortenAddress", () => {
	it("shortens long Stellar addresses", () => {
		expect(shortenAddress("GABCDEFGHIJKLMNOPQRSTUVWXYZ")).toBe("GABC…WXYZ");
		expect(shortenAddress("GSHORT")).toBe("GSHORT");
	});
});
