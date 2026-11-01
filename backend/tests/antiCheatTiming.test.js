jest.mock("../config/supabase", () => ({}));
jest.mock("../models/gameModel", () => ({ recordCheatAnalysis: jest.fn() }));
jest.mock("../services/botService", () => ({
	analyzeFen: jest.fn(),
	boardToFEN: jest.fn(() => "test-fen"),
}));

const {
	analyzeMoveTimeDistribution,
	calculateVariance,
	calculatePearsonCorrelation,
} = require("../services/antiCheatService");
const {
	recordMoveSubmissionTimestamp,
	getMoveSubmissionTimestamps,
	clearMoveSubmissionTimestamps,
} = require("../socket/moveAuthority");

describe("Issue #553: Compute move time entropy variance to flag programmatic bot play", () => {
	beforeEach(() => {
		clearMoveSubmissionTimestamps("game_test");
	});

	describe("calculateVariance", () => {
		it("calculates accurate population variance σ²", () => {
			// Values: [2, 4, 4, 4, 5, 5, 7, 9]. Mean = 5.
			// Squared diffs: [9, 1, 1, 1, 0, 0, 4, 16] = 32 / 8 = 4.
			const values = [2, 4, 4, 4, 5, 5, 7, 9];
			expect(calculateVariance(values)).toBe(4);
		});

		it("returns 0 for empty array or identical values", () => {
			expect(calculateVariance([])).toBe(0);
			expect(calculateVariance([1.2, 1.2, 1.2, 1.2])).toBe(0);
		});
	});

	describe("calculatePearsonCorrelation", () => {
		it("calculates accurate Pearson correlation R", () => {
			const x = [1, 2, 3, 4, 5];
			const y = [2, 4, 6, 8, 10]; // Perfect positive correlation
			expect(calculatePearsonCorrelation(x, y)).toBe(1);

			const yNeg = [10, 8, 6, 4, 2]; // Perfect negative correlation
			expect(calculatePearsonCorrelation(x, yNeg)).toBe(-1);
		});

		it("returns 0 when there is no variation or independent arrays", () => {
			const x = [1.2, 1.2, 1.2, 1.2];
			const y = [10, 20, 30, 40];
			expect(calculatePearsonCorrelation(x, y)).toBe(0);
		});
	});

	describe("analyzeMoveTimeDistribution", () => {
		it("flags synthetic bot move sequences with constant delay (low variance, isSuspectTiming: true)", () => {
			// Synthetic bot with fixed delay: 1.2s ± 0.02s across 20 moves
			const botMoveTimes = [
				1.21, 1.19, 1.20, 1.22, 1.18, 1.21, 1.20, 1.19, 1.22, 1.20,
				1.21, 1.19, 1.20, 1.22, 1.18, 1.21, 1.20, 1.19, 1.22, 1.20,
			];
			const evaluations = [
				15, 20, 110, 350, 40, 25, 90, 200, 30, 45,
				80, 150, 30, 60, 400, 12, 18, 220, 45, 10,
			];

			const result = analyzeMoveTimeDistribution(botMoveTimes, evaluations);

			expect(result.isSuspectTiming).toBe(true);
			expect(result.timingVariance).toBeLessThan(0.01);
			expect(result.flagReason).toMatch(/Low move time variance/);
			// Bot delays do not correlate with position complexity
			expect(Math.abs(result.complexityCorrelation)).toBeLessThan(0.3);
		});

		it("flags synthetic uniform bot millisecond timestamps", () => {
			// Durations in milliseconds: 1200ms ± 15ms across 16 moves
			const botMoveTimesMs = Array.from({ length: 16 }, () => 1200 + (Math.random() * 20 - 10));
			const result = analyzeMoveTimeDistribution(botMoveTimesMs);

			expect(result.isSuspectTiming).toBe(true);
			expect(result.timingVariance).toBeLessThan(0.01);
		});

		it("keeps natural human deliberation low risk without false positives", () => {
			// Natural human timing: recaptures / book are fast (0.5s - 1.5s), tactics are long (12s - 25s)
			const humanMoveTimes = [
				0.8, 1.2, 0.9, 1.5, 1.1,
				8.5, 14.2, 0.6, 22.4, 3.2,
				11.8, 0.7, 18.0, 1.4, 9.6,
				16.2, 0.5, 12.1, 4.5, 7.8,
			];
			// Evals correlate with thinking time: high eval swings have longer deliberation
			const evaluations = [
				10, 12, 15, 14, 20,
				85, 140, 10, 260, 35,
				120, 15, 190, 20, 95,
				170, 10, 130, 40, 80,
			];

			const result = analyzeMoveTimeDistribution(humanMoveTimes, evaluations);

			expect(result.isSuspectTiming).toBe(false);
			expect(result.timingVariance).toBeGreaterThan(10);
			expect(result.flagReason).toBeNull();
			// Deliberation positively correlates with position complexity
			expect(result.complexityCorrelation).toBeGreaterThan(0.7);
		});

		it("does not flag sequences with fewer than minMoves (< 15)", () => {
			const shortBotSequence = [1.2, 1.2, 1.2, 1.2, 1.2, 1.2, 1.2, 1.2]; // 8 moves
			const result = analyzeMoveTimeDistribution(shortBotSequence);

			expect(result.isSuspectTiming).toBe(false);
			expect(result.timingVariance).toBe(0);
		});
	});

	describe("moveAuthority move timestamp tracking", () => {
		it("records and retrieves precise millisecond timestamps per move submission", () => {
			const t1 = 1700000000000;
			const t2 = 1700000002500;

			recordMoveSubmissionTimestamp("game_test", "white", t1);
			recordMoveSubmissionTimestamp("game_test", "white", t2);
			recordMoveSubmissionTimestamp("game_test", "black", t1 + 1000);

			const whiteTimestamps = getMoveSubmissionTimestamps("game_test", "white");
			const blackTimestamps = getMoveSubmissionTimestamps("game_test", "black");

			expect(whiteTimestamps).toEqual([t1, t2]);
			expect(blackTimestamps).toEqual([t1 + 1000]);

			clearMoveSubmissionTimestamps("game_test");
			expect(getMoveSubmissionTimestamps("game_test", "white")).toEqual([]);
		});
	});
});
