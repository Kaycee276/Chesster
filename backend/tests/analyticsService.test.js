jest.mock("../config/supabase");

const analyticsService = require("../services/analyticsService");

describe("AnalyticsService", () => {
	let supabase;

	beforeEach(() => {
		supabase = require("../config/supabase");
		jest.clearAllMocks();
	});

	describe("aggregateHourlyMetrics", () => {
		test("aggregates hourly metrics correctly from games table", async () => {
			const targetHour = new Date("2026-09-24T14:00:00.000Z");
			const mockGames = [
				{
					status: "completed",
					winner: "white",
					wager_amount: 100,
					token_address: null,
					player_white_address: "wallet1",
					player_black_address: "wallet2",
				},
				{
					status: "completed",
					winner: null, // draw
					wager_amount: 50.5,
					token_address: null,
					player_white_address: "wallet1",
					player_black_address: "wallet3",
				},
				{
					status: "active",
					winner: null,
					wager_amount: 75,
					token_address: null,
					player_white_address: "wallet2",
					player_black_address: "wallet3",
				},
			];

			supabase.from = jest.fn(() => ({
				select: jest.fn(() => ({
					gte: jest.fn(() => ({
						lt: jest.fn().mockResolvedValue({ data: mockGames, error: null }),
					})),
				})),
				upsert: jest.fn(() => ({
					select: jest.fn().mockResolvedValue({ data: [{ id: 1 }], error: null }),
				})),
			}));

			const result = await analyticsService.aggregateHourlyMetrics(targetHour);

			expect(result).toMatchObject({
				bucketStart: "2026-09-24T14:00:00.000Z",
				rowsInserted: 1,
				aggregatedMetrics: {
					totalMatches: 3,
					completedMatches: 2,
					uniquePlayers: 3,
					totalWagerXlm: 225.5,
					totalWagerUsdc: 0,
				},
			});
		});

		test("correctly separates XLM and USDC wagers by token address", async () => {
			const targetHour = new Date("2026-09-24T14:00:00.000Z");
			const mockGames = [
				{
					status: "completed",
					winner: "white",
					wager_amount: 100,
					token_address: "usdc", // token address containing 'usdc'
					player_white_address: "wallet1",
					player_black_address: "wallet2",
				},
				{
					status: "completed",
					winner: "black",
					wager_amount: 50,
					token_address: "native", // XLM
					player_white_address: "wallet1",
					player_black_address: "wallet3",
				},
				{
					status: "completed",
					winner: null,
					wager_amount: 25.5,
					token_address: null, // defaults to XLM
					player_white_address: "wallet2",
					player_black_address: "wallet3",
				},
			];

			supabase.from = jest.fn(() => ({
				select: jest.fn(() => ({
					gte: jest.fn(() => ({
						lt: jest.fn().mockResolvedValue({ data: mockGames, error: null }),
					})),
				})),
				upsert: jest.fn(() => ({
					select: jest.fn().mockResolvedValue({ data: [{ id: 1 }], error: null }),
				})),
			}));

			const result = await analyticsService.aggregateHourlyMetrics(targetHour);

			expect(result.aggregatedMetrics).toMatchObject({
				totalMatches: 3,
				completedMatches: 3,
				uniquePlayers: 3,
				totalWagerXlm: 75.5, // 50 + 25.5
				totalWagerUsdc: 100,
			});
		});

		test("is idempotent: multiple calls for the same hour do not create duplicates", async () => {
			const targetHour = new Date("2026-09-24T14:00:00.000Z");
			const mockGames = [
				{
					status: "completed",
					winner: "white",
					wager_amount: 100,
					token_address: null,
					player_white_address: "wallet1",
					player_black_address: "wallet2",
				},
			];

			const selectMock = jest.fn(() => ({
				gte: jest.fn(() => ({
					lt: jest.fn().mockResolvedValue({ data: mockGames, error: null }),
				})),
			}));
			const upsertMock = jest.fn(() => ({
				select: jest.fn().mockResolvedValue({ data: [{ id: 1 }], error: null }),
			}));

			supabase.from = jest.fn((tableName) => {
				if (tableName === "games") {
					return { select: selectMock };
				} else if (tableName === "hourly_platform_metrics") {
					return { upsert: upsertMock };
				}
			});

			// Call aggregateHourlyMetrics twice for the same hour
			const result1 = await analyticsService.aggregateHourlyMetrics(targetHour);
			const result2 = await analyticsService.aggregateHourlyMetrics(targetHour);

			// Both calls should succeed
			expect(result1.bucketStart).toBe("2026-09-24T14:00:00.000Z");
			expect(result2.bucketStart).toBe("2026-09-24T14:00:00.000Z");

			// Verify upsert was called with onConflict configuration (idempotent)
			expect(upsertMock).toHaveBeenCalledTimes(2);
			// Both calls should use the same onConflict configuration
			const upsertCall1 = upsertMock.mock.calls[0];
			const upsertCall2 = upsertMock.mock.calls[1];
			expect(upsertCall1[1]).toEqual({ onConflict: "bucket_start" });
			expect(upsertCall2[1]).toEqual({ onConflict: "bucket_start" });
		});

		test("handles empty hour with no games gracefully", async () => {
			const targetHour = new Date("2026-09-24T14:00:00.000Z");

			supabase.from = jest.fn(() => ({
				select: jest.fn(() => ({
					gte: jest.fn(() => ({
						lt: jest.fn().mockResolvedValue({ data: [], error: null }),
					})),
				})),
				upsert: jest.fn(() => ({
					select: jest.fn().mockResolvedValue({ data: [{ id: 1 }], error: null }),
				})),
			}));

			const result = await analyticsService.aggregateHourlyMetrics(targetHour);

			expect(result.aggregatedMetrics).toMatchObject({
				totalMatches: 0,
				completedMatches: 0,
				uniquePlayers: 0,
				totalWagerXlm: 0,
				totalWagerUsdc: 0,
			});
		});

		test("normalizes hour boundary correctly for various input times", async () => {
			const testCases = [
				{
					input: new Date("2026-09-24T14:37:45.123Z"),
					expectedBucket: "2026-09-24T14:00:00.000Z",
				},
				{
					input: new Date("2026-09-24T14:00:00.000Z"),
					expectedBucket: "2026-09-24T14:00:00.000Z",
				},
				{
					input: new Date("2026-09-24T14:59:59.999Z"),
					expectedBucket: "2026-09-24T14:00:00.000Z",
				},
				{
					input: "2026-09-24T14:30:00.000Z", // ISO string input
					expectedBucket: "2026-09-24T14:00:00.000Z",
				},
			];

			for (const testCase of testCases) {
				supabase.from = jest.fn(() => ({
					select: jest.fn(() => ({
						gte: jest.fn(() => ({
							lt: jest.fn().mockResolvedValue({ data: [], error: null }),
						})),
					})),
					upsert: jest.fn(() => ({
						select: jest.fn().mockResolvedValue({ data: [{ id: 1 }], error: null }),
					})),
				}));

				const result = await analyticsService.aggregateHourlyMetrics(testCase.input);
				expect(result.bucketStart).toBe(testCase.expectedBucket);
			}
		});

		test("deduplicates unique players correctly", async () => {
			const targetHour = new Date("2026-09-24T14:00:00.000Z");
			const mockGames = [
				{
					status: "completed",
					winner: "white",
					wager_amount: 100,
					token_address: null,
					player_white_address: "wallet1", // appears in multiple games
					player_black_address: "wallet2",
				},
				{
					status: "completed",
					winner: "black",
					wager_amount: 50,
					token_address: null,
					player_white_address: "wallet1", // wallet1 again — should not double-count
					player_black_address: "wallet3",
				},
				{
					status: "completed",
					winner: null,
					wager_amount: 25,
					token_address: null,
					player_white_address: "wallet2", // wallet2 again
					player_black_address: "wallet3", // wallet3 again
				},
			];

			supabase.from = jest.fn(() => ({
				select: jest.fn(() => ({
					gte: jest.fn(() => ({
						lt: jest.fn().mockResolvedValue({ data: mockGames, error: null }),
					})),
				})),
				upsert: jest.fn(() => ({
					select: jest.fn().mockResolvedValue({ data: [{ id: 1 }], error: null }),
				})),
			}));

			const result = await analyticsService.aggregateHourlyMetrics(targetHour);

			// Only 3 unique players: wallet1, wallet2, wallet3
			expect(result.aggregatedMetrics.uniquePlayers).toBe(3);
		});

		test("handles null player addresses gracefully", async () => {
			const targetHour = new Date("2026-09-24T14:00:00.000Z");
			const mockGames = [
				{
					status: "completed",
					winner: "white",
					wager_amount: 100,
					token_address: null,
					player_white_address: "wallet1",
					player_black_address: null, // null address
				},
				{
					status: "completed",
					winner: "black",
					wager_amount: 50,
					token_address: null,
					player_white_address: null, // null address
					player_black_address: "wallet2",
				},
				{
					status: "active",
					winner: null,
					wager_amount: 25,
					token_address: null,
					player_white_address: null, // both null
					player_black_address: null,
				},
			];

			supabase.from = jest.fn(() => ({
				select: jest.fn(() => ({
					gte: jest.fn(() => ({
						lt: jest.fn().mockResolvedValue({ data: mockGames, error: null }),
					})),
				})),
				upsert: jest.fn(() => ({
					select: jest.fn().mockResolvedValue({ data: [{ id: 1 }], error: null }),
				})),
			}));

			const result = await analyticsService.aggregateHourlyMetrics(targetHour);

			// Only 2 unique players (nulls are not added to the set)
			expect(result.aggregatedMetrics.uniquePlayers).toBe(2);
			expect(result.aggregatedMetrics.totalMatches).toBe(3);
		});

		test("throws error when games query fails", async () => {
			const targetHour = new Date("2026-09-24T14:00:00.000Z");
			const mockError = new Error("Database connection failed");

			supabase.from = jest.fn(() => ({
				select: jest.fn(() => ({
					gte: jest.fn(() => ({
						lt: jest.fn().mockResolvedValue({ data: null, error: mockError }),
					})),
				})),
			}));

			await expect(analyticsService.aggregateHourlyMetrics(targetHour)).rejects.toThrow(
				"Database connection failed"
			);
		});

		test("throws error when upsert fails", async () => {
			const targetHour = new Date("2026-09-24T14:00:00.000Z");
			const mockGames = [
				{
					status: "completed",
					winner: "white",
					wager_amount: 100,
					token_address: null,
					player_white_address: "wallet1",
					player_black_address: "wallet2",
				},
			];
			const mockError = new Error("Unique constraint violation");

			supabase.from = jest.fn(() => ({
				select: jest.fn(() => ({
					gte: jest.fn(() => ({
						lt: jest.fn().mockResolvedValue({ data: mockGames, error: null }),
					})),
				})),
				upsert: jest.fn(() => ({
					select: jest.fn().mockResolvedValue({ data: null, error: mockError }),
				})),
			}));

			await expect(analyticsService.aggregateHourlyMetrics(targetHour)).rejects.toThrow(
				"Unique constraint violation"
			);
		});

		test("handles null wager amounts gracefully", async () => {
			const targetHour = new Date("2026-09-24T14:00:00.000Z");
			const mockGames = [
				{
					status: "completed",
					winner: "white",
					wager_amount: null,
					token_address: null,
					player_white_address: "wallet1",
					player_black_address: "wallet2",
				},
				{
					status: "completed",
					winner: "black",
					wager_amount: 50,
					token_address: null,
					player_white_address: "wallet1",
					player_black_address: "wallet3",
				},
			];

			supabase.from = jest.fn(() => ({
				select: jest.fn(() => ({
					gte: jest.fn(() => ({
						lt: jest.fn().mockResolvedValue({ data: mockGames, error: null }),
					})),
				})),
				upsert: jest.fn(() => ({
					select: jest.fn().mockResolvedValue({ data: [{ id: 1 }], error: null }),
				})),
			}));

			const result = await analyticsService.aggregateHourlyMetrics(targetHour);

			expect(result.aggregatedMetrics).toMatchObject({
				totalWagerXlm: 50,
				totalWagerUsdc: 0,
			});
		});

		test("correctly formats decimal precision for wager amounts in result", async () => {
			const targetHour = new Date("2026-09-24T14:00:00.000Z");
			const mockGames = [
				{
					status: "completed",
					winner: "white",
					wager_amount: "1.23456789", // 8 decimal places
					token_address: null,
					player_white_address: "wallet1",
					player_black_address: "wallet2",
				},
				{
					status: "completed",
					winner: "black",
					wager_amount: "2.34567890",
					token_address: "usdc", // USDC
					player_white_address: "wallet1",
					player_black_address: "wallet3",
				},
			];

			supabase.from = jest.fn(() => ({
				select: jest.fn(() => ({
					gte: jest.fn(() => ({
						lt: jest.fn().mockResolvedValue({ data: mockGames, error: null }),
					})),
				})),
				upsert: jest.fn(() => ({
					select: jest.fn().mockResolvedValue({ data: [{ id: 1 }], error: null }),
				})),
			}));

			const result = await analyticsService.aggregateHourlyMetrics(targetHour);

			// XLM should be formatted to 7 decimals
			expect(result.aggregatedMetrics.totalWagerXlm).toBe(1.2345679); // rounded to 7 decimals
			// USDC should be formatted to 2 decimals
			expect(result.aggregatedMetrics.totalWagerUsdc).toBe(2.35); // rounded to 2 decimals
		});
	});

	describe("integration with other analytics functions", () => {
		test("aggregateHourlyMetrics exports correctly and is callable", () => {
			expect(typeof analyticsService.aggregateHourlyMetrics).toBe("function");
		});

		test("all analytics functions are exported", () => {
			expect(analyticsService).toHaveProperty("getDailyActivePlayers");
			expect(analyticsService).toHaveProperty("getDailyMatchVolume");
			expect(analyticsService).toHaveProperty("getTokenWageredSummary");
			expect(analyticsService).toHaveProperty("getDashboardSummary");
			expect(analyticsService).toHaveProperty("aggregateHourlyMetrics");
		});
	});
});
