jest.mock("../config/supabase", () => ({}));

const eloService = require("../services/eloService");

describe("EloService dynamic ratings", () => {
	test.each([
		[0, 1500, 40],
		[19, 1500, 40],
		[20, 1500, 20],
		[1999, 2200, 10],
		[20, 2000, 10],
	])("uses the expected K-factor for %i games and rating %i", (gamesPlayed, rating, expectedK) => {
		expect(eloService.getKFactor(gamesPlayed, rating)).toBe(expectedK);
	});

	test("calculates rating changes with each player's K-factor", () => {
		const expected = eloService.calculateExpectedScore(1500, 1500);
		const provisional = eloService.calculateNewRating(1500, expected, 1, eloService.getKFactor(5, 1500));
		const established = eloService.calculateNewRating(1500, expected, 1, eloService.getKFactor(100, 1500));
		const master = eloService.calculateNewRating(2000, expected, 1, eloService.getKFactor(200, 2000));

		expect(provisional).toBe(1520);
		expect(established).toBe(1510);
		expect(master).toBe(2005);
	});

	test("applies each player's K-factor in the rating update", async () => {
		const users = {
			white: { id: "white", wallet_address: "GWHITE", elo_rating: 1500, version: 1 },
			black: { id: "black", wallet_address: "GBLACK", elo_rating: 1500, version: 1 },
		};
		const stats = [
			{ wallet_address: "GWHITE", games_played: 5 },
			{ wallet_address: "GBLACK", games_played: 100 },
		];
		const updates = [];
		const db = {
			from(table) {
				const filters = {};
				let patch;
				const query = {
					select: () => query,
					eq: (column, value) => { filters[column] = value; return query; },
					in: (_column, values) => { filters.wallets = values; return query; },
					single: async () => ({ data: users[filters.id], error: null }),
					update: (nextPatch) => { patch = nextPatch; return query; },
					maybeSingle: async () => {
						updates.push({ id: filters.id, patch });
						return { data: { id: filters.id }, error: null };
					},
					then: (resolve, reject) => Promise.resolve({
						data: table === "player_stats" ? stats.filter((row) => filters.wallets.includes(row.wallet_address)) : [],
						error: null,
					}).then(resolve, reject),
				};
				return query;
			},
		};
		jest.spyOn(console, "log").mockImplementation(() => {});

		await eloService.updateEloRatings("white", "black", "white", db);

		expect(updates).toEqual([
			{ id: "white", patch: { elo_rating: 1520, version: 2 } },
			{ id: "black", patch: { elo_rating: 1490, version: 2 } },
		]);
	});

	test("keeps Elo ratings at or above 400", () => {
		expect(eloService.calculateNewRating(400, 1, 0, 40)).toBe(400);
		expect(
			eloService.calculateGlicko2Rating(
				{ rating: 400, ratingDeviation: 350, volatility: 0.06 },
				{ rating: 3000, ratingDeviation: 30 },
				0,
			).rating,
		).toBeGreaterThanOrEqual(400);
	});

	test("increases rating deviation after inactivity and caps it at 350", () => {
		const player = { rating: 1500, ratingDeviation: 100, volatility: 0.06 };
		const afterInactivity = eloService.inflateRatingDeviation(player, 30 * 24 * 60 * 60);
		const atCap = eloService.inflateRatingDeviation({ ...player, ratingDeviation: 349 }, 365 * 24 * 60 * 60);

		expect(afterInactivity.ratingDeviation).toBeGreaterThan(player.ratingDeviation);
		expect(atCap.ratingDeviation).toBe(350);
	});
});
