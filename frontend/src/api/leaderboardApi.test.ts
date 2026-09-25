import { describe, it, expect, vi, afterEach } from "vitest";
import { getLeaderboard, type LeaderboardEntry } from "./leaderboardApi";

const sampleEntry: LeaderboardEntry = {
	rank: 1,
	address: "GABC1234567890",
	username: "Magnus",
	elo: 2850,
	wins: 40,
	losses: 2,
	draws: 8,
	winRate: 0.8,
	totalEarnings: 125,
};

function mockFetch(response: {
	ok: boolean;
	status?: number;
	json: () => Promise<unknown>;
}) {
	const fn = vi.fn().mockResolvedValue(response);
	vi.stubGlobal("fetch", fn);
	return fn;
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("getLeaderboard", () => {
	it("returns the ranked entries on a successful response", async () => {
		const fetchMock = mockFetch({
			ok: true,
			status: 200,
			json: async () => ({ success: true, data: [sampleEntry] }),
		});

		const result = await getLeaderboard();

		expect(result).toEqual([sampleEntry]);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0][0]).toContain("/leaderboard");
	});

	it("returns an empty array when the payload has no data array", async () => {
		mockFetch({
			ok: true,
			status: 200,
			json: async () => ({ success: true }),
		});

		await expect(getLeaderboard()).resolves.toEqual([]);
	});

	it("returns an empty array when data is not an array", async () => {
		mockFetch({
			ok: true,
			status: 200,
			json: async () => ({ success: true, data: null }),
		});

		await expect(getLeaderboard()).resolves.toEqual([]);
	});

	it("throws on a non-OK response", async () => {
		mockFetch({
			ok: false,
			status: 500,
			json: async () => ({ message: "boom" }),
		});

		await expect(getLeaderboard()).rejects.toThrow(/status 500/);
	});

	it("propagates a network error", async () => {
		const fn = vi.fn().mockRejectedValue(new Error("network down"));
		vi.stubGlobal("fetch", fn);

		await expect(getLeaderboard()).rejects.toThrow("network down");
	});
});
