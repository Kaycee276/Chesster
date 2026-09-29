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
