import { describe, it, expect, vi, afterEach } from "vitest";
import {
	fetchPlayerProfile,
	normalizeProfile,
	ProfileNotFoundError,
} from "../src/api/profileApi";

const ADDRESS = "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV";

describe("normalizeProfile", () => {
	it("maps a camelCase payload", () => {
		const profile = normalizeProfile(
			{
				address: ADDRESS,
				username: "magnus",
				rating: 1520,
				stats: { games: 10, wins: 6, draws: 1, losses: 3 },
				modes: {
					blitz: {
						rating: 1480,
						games: 4,
						wins: 2,
						draws: 0,
						losses: 2,
						ratingHistory: [{ date: "2026-01-02T00:00:00Z", rating: 1480 }],
					},
				},
				ratingHistory: [
					{ date: "2026-01-02T00:00:00Z", rating: 1520, gameCode: "B" },
					{ date: "2026-01-01T00:00:00Z", rating: 1500, gameCode: "A" },
				],
				recentGames: [
					{
						gameCode: "B",
						opponentAddress: "GOPP",
						result: "win",
						mode: "blitz",
						color: "white",
						ratingChange: 20,
						playedAt: "2026-01-02T00:00:00Z",
					},
				],
			},
			ADDRESS,
		);

		expect(profile.username).toBe("magnus");
		expect(profile.rating).toBe(1520);
		expect(profile.stats).toEqual({ games: 10, wins: 6, draws: 1, losses: 3 });
		expect(profile.modes.blitz?.rating).toBe(1480);
		expect(profile.modes.bullet).toBeUndefined();
		// History is sorted chronologically
		expect(profile.ratingHistory.map((p) => p.gameCode)).toEqual(["A", "B"]);
		expect(profile.recentGames[0]).toEqual({
			gameCode: "B",
			opponentAddress: "GOPP",
			opponentName: null,
			result: "win",
			mode: "blitz",
			color: "white",
			ratingChange: 20,
			playedAt: "2026-01-02T00:00:00Z",
		});
	});

	it("maps snake_case column names", () => {
		const profile = normalizeProfile(
			{
				wallet_address: ADDRESS,
				elo_rating: "1333",
				avatar_url: "https://img/x.png",
				total_games: 3,
				wins: 1,
				draws: 1,
				losses: 1,
				rating_history: [{ created_at: "2026-02-01T00:00:00Z", elo_rating: 1333, game_code: "X" }],
				recent_games: [
					{ game_code: "X", opponent_address: "GOPP", result: "Lost", game_mode: "Rapid", rating_change: -8 },
				],
			},
			"fallback",
		);

		expect(profile.address).toBe(ADDRESS);
		expect(profile.rating).toBe(1333);
		expect(profile.avatarUrl).toBe("https://img/x.png");
		expect(profile.stats).toEqual({ games: 3, wins: 1, draws: 1, losses: 1 });
		expect(profile.ratingHistory).toEqual([{ date: "2026-02-01T00:00:00Z", rating: 1333, gameCode: "X" }]);
		expect(profile.recentGames[0]).toMatchObject({ result: "loss", mode: "rapid", ratingChange: -8 });
	});

	it("is resilient to missing or malformed sections", () => {
		const profile = normalizeProfile(
			{
				stats: { wins: 2, draws: 0, losses: 1 },
				ratingHistory: [{ date: "not a date", rating: 1 }, { rating: 1500 }, "junk"],
				recentGames: [{ gameCode: "A" }, { result: "win" }, null],
				modes: { blitz: "nope", classical: { games: 1 } },
			},
			ADDRESS,
		);

		expect(profile.address).toBe(ADDRESS);
		expect(profile.rating).toBeNull();
		// games is never lower than wins + draws + losses
		expect(profile.stats.games).toBe(3);
		expect(profile.ratingHistory).toEqual([]);
		expect(profile.recentGames).toEqual([]);
		expect(profile.modes).toEqual({});
	});

	it("handles a non-object payload", () => {
		const profile = normalizeProfile(null, ADDRESS);
		expect(profile.stats).toEqual({ games: 0, wins: 0, draws: 0, losses: 0 });
		expect(profile.recentGames).toEqual([]);
	});
});

describe("fetchPlayerProfile", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	const mockFetch = (status: number, body: unknown) =>
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(typeof body === "string" ? body : JSON.stringify(body), { status }),
		);

	it("requests the profile endpoint and normalises the envelope", async () => {
		const spy = mockFetch(200, { success: true, data: { rating: 1400, wins: 1 } });

		const profile = await fetchPlayerProfile(ADDRESS);

		expect(String(spy.mock.calls[0][0])).toMatch(new RegExp(`/api/users/${ADDRESS}/profile$`));
		expect(profile.address).toBe(ADDRESS);
		expect(profile.rating).toBe(1400);
	});

	it("throws ProfileNotFoundError on 404", async () => {
		mockFetch(404, { success: false, error: "Profile not found" });
		await expect(fetchPlayerProfile(ADDRESS)).rejects.toBeInstanceOf(ProfileNotFoundError);
	});

	it("surfaces backend error messages", async () => {
		mockFetch(500, { success: false, error: "Database unavailable" });
		await expect(fetchPlayerProfile(ADDRESS)).rejects.toThrow("Database unavailable");
	});

	it("handles non-JSON error bodies", async () => {
		mockFetch(502, "<html>Bad gateway</html>");
		await expect(fetchPlayerProfile(ADDRESS)).rejects.toThrow("HTTP 502");
	});

	it("treats success: false as an error", async () => {
		mockFetch(200, { success: false, error: "Nope" });
		await expect(fetchPlayerProfile(ADDRESS)).rejects.toThrow("Nope");
	});
});
