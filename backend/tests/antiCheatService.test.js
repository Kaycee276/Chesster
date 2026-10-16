jest.mock("../config/supabase", () => ({}));
jest.mock("../models/gameModel", () => ({ recordCheatAnalysis: jest.fn() }));
jest.mock("../services/botService", () => ({
	analyzeFen: jest.fn(),
	boardToFEN: jest.fn(() => "test-fen"),
}));

const {
	AntiCheatService,
	FLAG_THRESHOLD,
	calculateAnomalyScore,
	calculateTimingEntropy,
	summarizeCentipawnLoss,
	computeWindowedCentipawnLoss,
} = require("../services/antiCheatService");

describe("AntiCheatService", () => {
	test("identifies synthetic uniform bot telemetry as highly anomalous", () => {
		const moveDurationsMs = Array.from({ length: 12 }, () => 2500);
		const score = calculateAnomalyScore({
			moveDurationsMs,
			engineMatches: Array.from({ length: 12 }, () => true),
			centipawnLosses: Array.from({ length: 12 }, () => 0),
		});

		expect(calculateTimingEntropy(moveDurationsMs)).toBe(0);
		expect(score).toBeGreaterThan(FLAG_THRESHOLD);
	});

	test("keeps varied human telemetry below the review threshold", () => {
		const moveDurationsMs = [450, 7200, 1300, 15400, 2800, 9000, 610, 11200, 4300, 21000];
		const score = calculateAnomalyScore({
			moveDurationsMs,
			engineMatches: [false, false, true, false, false, false, true, false, false, false],
			centipawnLosses: [85, 210, 40, 330, 145, 98, 62, 270, 125, 190],
		});

		expect(calculateTimingEntropy(moveDurationsMs)).toBeGreaterThan(0.5);
		expect(score).toBeLessThan(FLAG_THRESHOLD);
	});

	test("summarizes the centipawn loss distribution", () => {
		expect(summarizeCentipawnLoss([5, 10, 25, 40, 100])).toEqual({
			count: 5,
			mean: 36,
			median: 25,
			p90: 40,
		});
	});

	test("computes rolling ten-move centipawn loss and engine match rate", () => {
		const windows = computeWindowedCentipawnLoss([
			...Array.from({ length: 11 }, (_, i) => ({ centipawnLoss: i === 10 ? 20 : 2, matchesTopMove: i < 9 })),
		]);

		expect(windows).toHaveLength(2);
		expect(windows[0]).toMatchObject({ start: 0, end: 9, averageCentipawnLoss: 2, engineMatchRate: 0.9 });
		expect(windows[1].averageCentipawnLoss).toBe(3.8);
	});

	test("flags an engine-like ten-move streak for a low-rated player only", () => {
		const service = new AntiCheatService({ db: {}, games: {} });
		const telemetry = [500, 2500, 8000, 900, 5200, 300, 10000, 1200, 3000, 250]
			.map((move_duration_ms) => ({ move_duration_ms }));
		const engineResults = Array.from({ length: 10 }, () => ({ matchesTopMove: true, centipawnLoss: 2 }));

		const lowRated = service.buildPlayerAnalysis("white", "GAMATEUR", telemetry, engineResults, 1400);
		const experienced = service.buildPlayerAnalysis("white", "EXPERIENCED", telemetry, engineResults, 1800);
		const unknown = service.buildPlayerAnalysis("white", "UNKNOWN", telemetry, engineResults);

		expect(lowRated.flagged).toBe(true);
		expect(lowRated.suspicionScore).toBeGreaterThan(0);
		expect(lowRated.reasons).toContain("low-rated player has a 10-move engine-like ACPL streak");
		expect(experienced.flagged).toBe(false);
		expect(unknown.flagged).toBe(false);
	});

	test("records millisecond move telemetry in match audit logs", async () => {
		const insert = jest.fn().mockResolvedValue({ error: null });
		const db = { from: jest.fn(() => ({ insert })) };
		const service = new AntiCheatService({ db, games: {} });
		const nowSpy = jest.spyOn(Date, "now").mockReturnValue(10_000);

		await service.recordMove({
			gameId: "game-1",
			gameCode: "GAME1",
			color: "white",
			playerAddress: "GWHITE",
			moveNumber: 1,
			move: { from: [6, 4], to: [4, 4] },
			boardBefore: [["before"]],
			boardAfter: [["after"]],
			turnStartedAt: new Date(7500).toISOString(),
		});

		expect(insert).toHaveBeenCalledWith(expect.objectContaining({
			game_id: "game-1",
			event_type: "move.submitted",
			move_timestamp_ms: 10_000,
			move_duration_ms: 2500,
			player_address: "GWHITE",
		}));
		nowSpy.mockRestore();
	});

	test("builds a flagged player analysis from bot-like telemetry", () => {
		const service = new AntiCheatService({ db: {}, games: {} });
		const telemetry = Array.from({ length: 10 }, () => ({
			player_address: "GBOT",
			move_duration_ms: 2000,
		}));
		const engineResults = Array.from({ length: 10 }, () => ({
			matchesTopMove: true,
			centipawnLoss: 0,
		}));

		const analysis = service.buildPlayerAnalysis("black", "GBOT", telemetry, engineResults);

		expect(analysis.flagged).toBe(true);
		expect(analysis.engineCorrelation).toBe(1);
		expect(analysis.stdDevMoveMs).toBe(0);
		expect(analysis.reasons).toEqual(expect.arrayContaining([
			"highly uniform move timing",
			"at least 90% correlation with Stockfish top moves",
		]));
	});
});
