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

describe("move time variance entropy (Issue #461)", () => {
	const {
		calculateMoveTimeEntropy,
		moveTimeEntropyScore,
		binMoveDuration,
		countLegalMoves,
		analyzeGameMoveTimes,
		LOW_ENTROPY_THRESHOLD,
		HIGH_ENTROPY_THRESHOLD,
	} = require("../services/antiCheatService");
	const chessEngine = require("../services/chessEngine");

	// Deterministic PRNG so the synthetic datasets are reproducible.
	function lcg(seed) {
		let state = seed;
		return () => {
			state = (state * 1664525 + 1013904223) % 4294967296;
			return state / 4294967296;
		};
	}

	/** Interleave per-colour think times into a timestamped game history. */
	function gameHistory(whiteDelays, blackDelays, extra = () => ({})) {
		const history = [];
		let clock = 0;
		for (let i = 0; i < Math.max(whiteDelays.length, blackDelays.length); i += 1) {
			for (const [color, delays] of [["white", whiteDelays], ["black", blackDelays]]) {
				if (i >= delays.length) continue;
				clock += delays[i];
				history.push({ color, timestamp: clock, ...extra(color, i) });
			}
		}
		return history;
	}

	// Natural human play: instant recaptures, routine moves, long thinks.
	const HUMAN_DELAYS = [
		1200, 800, 2500, 600, 3100, 2800, 7200, 1300, 450, 3700,
		9000, 4300, 2200, 1800, 5600, 3100, 32000, 6400, 700, 11200,
		2500, 1100, 4900, 13800, 3400,
	];
	// Bot with a fixed delay and small jitter (2.4s - 2.6s).
	const uniformBotDelays = (count, random = lcg(7)) => Array.from({ length: count }, () => 2400 + Math.round(random() * 200));
	// Bot drawing delays uniformly across every logarithmic interval.
	const spreadBotDelays = (count) => Array.from({ length: count }, (_, i) => [500, 1500, 3000, 6000, 12000, 24000][i % 6]);

	it("bins think times into 0-1s, 1-2s, 2-4s, 4-8s, 8-16s and >16s intervals", () => {
		expect([0, 999, 1000, 1999, 2000, 3999, 4000, 7999, 8000, 15999, 16000, 90000].map(binMoveDuration))
			.toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
	});

	it("normalises Shannon entropy against log2(K) to a 0..1 score", () => {
		expect(moveTimeEntropyScore([2500, 2500, 2500, 2500])).toBe(0);
		expect(moveTimeEntropyScore([500, 1500, 3000, 6000, 12000, 24000])).toBe(1);
		// Two equally likely bins: H = 1 bit, normalised by log2(6).
		expect(moveTimeEntropyScore([500, 500, 3000, 3000])).toBeCloseTo(1 / Math.log2(6), 4);
		expect(moveTimeEntropyScore([])).toBeNull();
	});

	it("calculateMoveTimeEntropy derives delays from consecutive timestamps", () => {
		expect(calculateMoveTimeEntropy([0, 500, 2000, 5000, 11000, 23000, 47000])).toBe(1);
		expect(calculateMoveTimeEntropy([1000, 3500, 6000, 8500, 11000])).toBe(0);
		expect(calculateMoveTimeEntropy([1000])).toBeNull();
	});

	it("scores human timing high and uniform bot timing below the 0.35 threshold", () => {
		const timing = analyzeGameMoveTimes(gameHistory(HUMAN_DELAYS, uniformBotDelays(25)));

		expect(timing.white.timeVarianceEntropyScore).toBeGreaterThan(0.75);
		expect(timing.white.timeVarianceEntropyScore).toBeLessThan(HIGH_ENTROPY_THRESHOLD);
		expect(timing.white.flagged).toBe(false);

		expect(timing.black.timeVarianceEntropyScore).toBeLessThan(LOW_ENTROPY_THRESHOLD);
		expect(timing.black.flags).toEqual([expect.objectContaining({ type: "low_time_variance_entropy", threshold: 0.35 })]);
		expect(timing.black.flagged).toBe(true);
	});

	it("flags near-maximal entropy only when combined with >90% engine correlation", () => {
		const history = gameHistory(spreadBotDelays(30), HUMAN_DELAYS);

		const withEngine = analyzeGameMoveTimes(history, { engineCorrelation: { white: 0.95, black: 0.4 } });
		expect(withEngine.white.timeVarianceEntropyScore).toBeGreaterThan(HIGH_ENTROPY_THRESHOLD);
		expect(withEngine.white.flags).toEqual([expect.objectContaining({
			type: "high_time_variance_entropy_engine_correlation",
			engineCorrelation: 0.95,
		})]);

		const withoutEngine = analyzeGameMoveTimes(history, { engineCorrelation: { white: 0.6 } });
		expect(withoutEngine.white.flagged).toBe(false);
	});

	it("excludes each player's first five moves and forced moves from the sample", () => {
		// Opening book moves are instant; forced replies are instant too.
		const whiteDelays = [100, 100, 100, 100, 100, ...HUMAN_DELAYS.slice(0, 12)];
		const history = gameHistory(whiteDelays, HUMAN_DELAYS.slice(0, 17), (color, i) => ({
			legalMoveCount: color === "white" && (i === 8 || i === 9) ? 1 : 30,
		}));
		const timing = analyzeGameMoveTimes(history);

		expect(timing.white.excludedMoves).toBe(7);
		expect(timing.white.sampleCount).toBe(10);
		expect(timing.white.histogram.reduce((sum, count) => sum + count, 0)).toBe(10);
	});

	it("withholds a score until enough non-book moves were played", () => {
		const timing = analyzeGameMoveTimes(gameHistory(uniformBotDelays(12), uniformBotDelays(12)));

		expect(timing.white.sampleCount).toBe(7);
		expect(timing.white.timeVarianceEntropyScore).toBeNull();
		expect(timing.white.flagged).toBe(false);
	});

	it("counts legal moves, stopping early at the requested limit", () => {
		const forced = Array.from({ length: 8 }, () => Array(8).fill("."));
		forced[7][0] = "K"; // white king a1
		forced[0][1] = "r"; // black rook b8 covers b1/b2
		forced[0][7] = "k";

		expect(countLegalMoves(chessEngine.initBoard(), "white")).toBe(20);
		expect(countLegalMoves(chessEngine.initBoard(), "white", 2)).toBe(2);
		expect(countLegalMoves(forced, "white")).toBe(1);
		expect(countLegalMoves(null, "white")).toBeNull();
	});

	it("adds the entropy score and flags to the player analysis", () => {
		const service = new AntiCheatService({ db: {}, games: {} });
		const telemetry = uniformBotDelays(20).map((move_duration_ms) => ({ move_duration_ms }));
		const engineResults = telemetry.map(() => ({ matchesTopMove: false, centipawnLoss: 80 }));

		const analysis = service.buildPlayerAnalysis("black", "GBOT", telemetry, engineResults, 1800);

		expect(analysis.timeVarianceEntropyScore).toBe(0);
		expect(analysis.entropySampleCount).toBe(15);
		expect(analysis.moveTimeHistogram).toEqual([0, 0, 15, 0, 0, 0]);
		expect(analysis.antiCheatFlags).toHaveLength(1);
		expect(analysis.flagged).toBe(true);
		expect(analysis.reasons).toContain("suspiciously uniform move time distribution (low time variance entropy)");
	});

	describe("inspectGameSession", () => {
		function fakeDb(telemetry) {
			const updates = [];
			return {
				updates,
				from(table) {
					const builder = {
						select() { return this; },
						eq() { return this; },
						order() { return Promise.resolve({ data: telemetry, error: null }); },
						maybeSingle() {
							if (table === "games") return Promise.resolve({ data: { player_white_address: "GHUMAN", player_black_address: "GBOT" }, error: null });
							return Promise.resolve({ data: { elo_rating: 1700 }, error: null });
						},
						update(values) {
							updates.push(values);
							return { eq: () => Promise.resolve({ error: null }) };
						},
					};
					return builder;
				},
			};
		}

		function telemetryRows() {
			const board = chessEngine.initBoard();
			return gameHistory(HUMAN_DELAYS, uniformBotDelays(25)).map((entry, index) => ({
				id: `log-${index}`,
				player_address: entry.color === "white" ? "GHUMAN" : "GBOT",
				move_timestamp_ms: entry.timestamp,
				move_duration_ms: null,
				event_data: { color: entry.color, moveNumber: index + 1, move: { from: [6, 4], to: [4, 4] }, boardBefore: board, boardAfter: board },
			}));
		}

		it("persists entropy flags and dispatches an audit alert for the flagged player", async () => {
			const games = { recordCheatAnalysis: jest.fn().mockResolvedValue(undefined) };
			const audit = { recordAntiCheatAlert: jest.fn().mockResolvedValue(undefined) };
			const engine = { analyzeFen: jest.fn().mockResolvedValue({ bestMove: "a2a3", scoreCp: 20 }) };
			const service = new AntiCheatService({ db: fakeDb(telemetryRows()), games, audit, engine, logger: { warn: jest.fn() } });

			const analysis = await service.inspectGameSession("game-1");

			expect(analysis.white.timeVarianceEntropyScore).toBeGreaterThan(0.75);
			expect(analysis.white.antiCheatFlags).toEqual([]);
			expect(analysis.black.timeVarianceEntropyScore).toBeLessThan(LOW_ENTROPY_THRESHOLD);
			expect(analysis.black.flagged).toBe(true);
			expect(games.recordCheatAnalysis).toHaveBeenCalledWith("game-1", analysis);
			expect(audit.recordAntiCheatAlert).toHaveBeenCalledTimes(1);
			expect(audit.recordAntiCheatAlert).toHaveBeenCalledWith(expect.objectContaining({
				gameId: "game-1",
				color: "black",
				playerAddress: "GBOT",
				flags: [expect.objectContaining({ type: "low_time_variance_entropy" })],
			}));
		});

		it("logs rather than throws when the audit alert cannot be written", async () => {
			const logger = { warn: jest.fn() };
			const service = new AntiCheatService({
				db: fakeDb(telemetryRows()),
				games: { recordCheatAnalysis: jest.fn() },
				audit: { recordAntiCheatAlert: jest.fn().mockRejectedValue(new Error("audit down")) },
				engine: { analyzeFen: jest.fn().mockResolvedValue({ bestMove: "a2a3", scoreCp: 20 }) },
				logger,
			});

			await expect(service.inspectGameSession("game-1")).resolves.toHaveProperty("black.flagged", true);
			expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("audit down"));
		});
	});

});

describe("auditService.recordAntiCheatAlert (Issue #461)", () => {
	const { recordAntiCheatAlert, ANTI_CHEAT_ALERT_EVENT } = require("../services/auditService");

	it("appends the entropy violation to the match audit trail", async () => {
		const insert = jest.fn().mockResolvedValue({ error: null });
		const db = { from: jest.fn(() => ({ insert })) };
		const flags = [{ type: "low_time_variance_entropy", timeVarianceEntropyScore: 0.1, threshold: 0.35 }];

		await recordAntiCheatAlert({ gameId: "game-1", color: "black", playerAddress: "GBOT", flags, timeVarianceEntropyScore: 0.1, engineCorrelation: 0.2 }, db);

		expect(db.from).toHaveBeenCalledWith("match_audit_logs");
		expect(insert).toHaveBeenCalledWith({
			game_id: "game-1",
			event_type: ANTI_CHEAT_ALERT_EVENT,
			player_address: "GBOT",
			event_data: { color: "black", flags, timeVarianceEntropyScore: 0.1, engineCorrelation: 0.2 },
		});
	});

	it("surfaces insert errors to the caller", async () => {
		const db = { from: () => ({ insert: jest.fn().mockResolvedValue({ error: new Error("rls denied") }) }) };

		await expect(recordAntiCheatAlert({ gameId: "game-1" }, db)).rejects.toThrow("rls denied");
	});
});
