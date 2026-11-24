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

describe("instant tactical refutation heuristic (Issue #643)", () => {
	const {
		AntiCheatService,
		evaluateMoveComplexity,
		evaluateTacticalResponse,
		detectInstantTacticalRefutations,
		TACTICAL_BURST_FLAG,
	} = require("../services/antiCheatService");
	const chessEngine = require("../services/chessEngine");

	const complex = { priorMoveEvalDiff: 350, legalMovesCount: 32 };
	const botMove = (moveNumber, overrides = {}) => ({
		moveNumber,
		durationMs: 120,
		isTopEngineMove: true,
		...complex,
		...overrides,
	});

	describe("evaluateMoveComplexity", () => {
		it("accepts volatile positions with many legal moves", () => {
			expect(evaluateMoveComplexity(complex)).toEqual({ complex: true, reason: "high_tactical_volatility" });
			expect(evaluateMoveComplexity({ priorMoveEvalDiff: -350, legalMovesCount: 32 }).complex).toBe(true);
		});

		it("ignores forced replies such as recaptures with a single legal move", () => {
			expect(evaluateMoveComplexity({ priorMoveEvalDiff: 900, legalMovesCount: 1 })).toEqual({ complex: false, reason: "forced_move" });
		});

		it("ignores quiet positions and positions with few choices", () => {
			expect(evaluateMoveComplexity({ priorMoveEvalDiff: 200, legalMovesCount: 32 }).reason).toBe("low_volatility");
			expect(evaluateMoveComplexity({ priorMoveEvalDiff: 500, legalMovesCount: 15 }).reason).toBe("few_legal_moves");
		});

		it("treats missing data as not complex", () => {
			expect(evaluateMoveComplexity({}).complex).toBe(false);
			expect(evaluateMoveComplexity({ priorMoveEvalDiff: null, legalMovesCount: 30 }).complex).toBe(false);
		});
	});

	describe("evaluateTacticalResponse", () => {
		it("flags an engine-top reply under 300ms in a complex position", () => {
			const flag = evaluateTacticalResponse(botMove(12), 350, 32);
			expect(flag).toMatchObject({ type: TACTICAL_BURST_FLAG, flag: "TACTICAL_BURST_FLAG", severity: "high", moveNumber: 12, durationMs: 120 });
		});

		it("does not flag human-speed replies, including exactly 300ms", () => {
			expect(evaluateTacticalResponse(botMove(12, { durationMs: 300 }), 350, 32)).toBeNull();
			expect(evaluateTacticalResponse(botMove(12, { durationMs: 4200 }), 350, 32)).toBeNull();
		});

		it("does not flag non-engine moves or unknown durations", () => {
			expect(evaluateTacticalResponse(botMove(12, { isTopEngineMove: false }), 350, 32)).toBeNull();
			expect(evaluateTacticalResponse(botMove(12, { durationMs: null }), 350, 32)).toBeNull();
		});

		it("does not flag fast forced recaptures", () => {
			expect(evaluateTacticalResponse(botMove(12), 900, 1)).toBeNull();
		});
	});

	describe("detectInstantTacticalRefutations", () => {
		it("flags a bot that refutes several complex positions instantly", () => {
			const result = detectInstantTacticalRefutations([botMove(10), botMove(14, { durationMs: 80 }), botMove(18, { durationMs: 250 })]);
			expect(result.bursts).toHaveLength(3);
			expect(result.flags).toEqual([expect.objectContaining({ type: TACTICAL_BURST_FLAG, burstCount: 3, moveNumbers: [10, 14, 18] })]);
			expect(result.suspicionBoost).toBe(30);
		});

		it("does not flag a single lucky fast reply", () => {
			const result = detectInstantTacticalRefutations([botMove(10), botMove(14, { durationMs: 5000 })]);
			expect(result.bursts).toHaveLength(1);
			expect(result.flags).toEqual([]);
			expect(result.suspicionBoost).toBe(0);
		});

		it("does not flag a human who thinks on complex positions and recaptures quickly", () => {
			const result = detectInstantTacticalRefutations([
				botMove(10, { durationMs: 6500 }),
				botMove(14, { durationMs: 9100 }),
				botMove(16, { durationMs: 90, legalMovesCount: 1, priorMoveEvalDiff: 900 }),
				botMove(18, { durationMs: 110, legalMovesCount: 1, priorMoveEvalDiff: 900 }),
			]);
			expect(result.flags).toEqual([]);
			expect(result.complexMoves).toBe(2);
		});

		it("caps the suspicion boost and tolerates empty input", () => {
			const many = Array.from({ length: 10 }, (_, i) => botMove(i + 1));
			expect(detectInstantTacticalRefutations(many).suspicionBoost).toBe(40);
			expect(detectInstantTacticalRefutations()).toMatchObject({ flags: [], suspicionBoost: 0 });
			expect(detectInstantTacticalRefutations([null, undefined]).flags).toEqual([]);
		});
	});

	describe("analyzeGame integration", () => {
		const board = chessEngine.initBoard();

		// White and black alternate; black answers every white move.
		function rows(blackDurationMs, whiteDurationMs = 4000) {
			return Array.from({ length: 12 }, (_, index) => {
				const color = index % 2 === 0 ? "white" : "black";
				return {
					id: `log-${index}`,
					player_address: color === "white" ? "GHUMAN" : "GBOT",
					move_timestamp_ms: 1_000 + index * 5_000,
					move_duration_ms: color === "white" ? whiteDurationMs : blackDurationMs,
					event_data: { color, moveNumber: index + 1, legalMoveCount: 30, move: { from: [6, 4], to: [4, 4] }, boardBefore: board, boardAfter: board },
				};
			});
		}

		function fakeDb(telemetry) {
			return {
				from(table) {
					return {
						select() { return this; },
						eq() { return this; },
						order() { return Promise.resolve({ data: telemetry, error: null }); },
						maybeSingle() {
							if (table === "games") return Promise.resolve({ data: { player_white_address: "GHUMAN", player_black_address: "GBOT" }, error: null });
							return Promise.resolve({ data: { elo_rating: 1700 }, error: null });
						},
						update() { return { eq: () => Promise.resolve({ error: null }) }; },
					};
				},
			};
		}

		// Every position evaluates to +400 for the side to move, so each opponent move
		// swung the eval by 800cp (400 + 400). bestMove matches the played move e2e4.
		function volatileEngine() {
			return {
				analyzeFen: jest.fn().mockImplementation(async () => ({ bestMove: "e2e4", scoreCp: 400 })),
			};
		}

		async function analyze(telemetry) {
			const games = { recordCheatAnalysis: jest.fn().mockResolvedValue(undefined) };
			const service = new AntiCheatService({ db: fakeDb(telemetry), games, engine: volatileEngine(), logger: { warn: jest.fn() } });
			const analysis = await service.analyzeGame("game-1");
			return { analysis, games };
		}

		it("flags instant engine-top replies, raises suspicion and persists the flag", async () => {
			const { analysis, games } = await analyze(rows(100));
			expect(analysis.black.antiCheatFlags).toEqual([expect.objectContaining({ type: TACTICAL_BURST_FLAG, severity: "high" })]);
			expect(analysis.black.flagged).toBe(true);
			expect(analysis.black.reasons.join(" ")).toMatch(/instant .* engine-top replies/);
			expect(analysis.black.suspicionScore).toBeGreaterThanOrEqual(40);
			expect(analysis.white.antiCheatFlags.map((flag) => flag.type)).not.toContain(TACTICAL_BURST_FLAG);
			expect(games.recordCheatAnalysis).toHaveBeenCalledWith("game-1", analysis);
		});

		it("does not add the flag when the same replies are human speed", async () => {
			const { analysis } = await analyze(rows(5000));
			expect(analysis.black.antiCheatFlags.map((flag) => flag.type)).not.toContain(TACTICAL_BURST_FLAG);
		});
	});
});

describe("FIDE centipawn loss (ACPL) distribution profiling (Issue #744)", () => {
	const {
		calculateACPL,
		profileACPLDistribution,
		ANTI_CHEAT_FLAG_SUSPICIOUS_ENGINE_ACCURACY,
	} = require("../services/antiCheatService");

	it("yields high ACPL and does not flag a blunder-heavy human game", () => {
		const moves = Array.from({ length: 24 }, (_, idx) => ({
			ply: idx + 9,
			bestEval: 150,
			playedEval: idx % 3 === 0 ? -120 : 80,
			isTop1: idx % 5 === 0,
		}));

		const acpl = calculateACPL(moves);
		const profile = profileACPLDistribution(moves);

		expect(acpl).toBeGreaterThan(100);
		expect(profile.acpl).toBe(acpl);
		expect(profile.stdDev).toBeGreaterThan(0);
		expect(profile.top1MatchRate).toBeLessThan(0.5);
		expect(profile.sampleSize).toBe(24);
		expect(profile.flagged).toBe(false);
		expect(profile.flagType).toBeNull();
	});

	it("flags near-perfect engine play (< 12 ACPL, > 90% top-1 match, >= 20 non-book plies) as SUSPICIOUS_ENGINE_ACCURACY", () => {
		const moves = Array.from({ length: 22 }, (_, idx) => ({
			ply: idx + 9,
			bestScore: 50,
			playedScore: idx === 0 ? 35 : 48,
			matchesTopMove: idx !== 0,
		}));

		const profile = profileACPLDistribution(moves);

		expect(profile.sampleSize).toBe(22);
		expect(profile.acpl).toBeLessThan(12);
		expect(profile.top1MatchRate).toBeGreaterThan(0.9);
		expect(profile.flagged).toBe(true);
		expect(profile.flagType).toBe(ANTI_CHEAT_FLAG_SUSPICIOUS_ENGINE_ACCURACY);
	});

	it("skips short book games, stalemates, and short resignations gracefully", () => {
		const shortBookGame = Array.from({ length: 8 }, (_, idx) => ({
			ply: idx + 1,
			bestEval: 20,
			playedEval: 20,
			isTop1: true,
		}));
		const shortResignation = Array.from({ length: 10 }, (_, idx) => ({
			ply: idx + 9,
			bestEval: 30,
			playedEval: 30,
			isTop1: true,
		}));

		expect(calculateACPL(shortBookGame)).toBeNull();
		expect(profileACPLDistribution(shortBookGame)).toEqual({
			acpl: null,
			stdDev: null,
			top1MatchRate: null,
			sampleSize: 0,
			flagged: false,
			flagType: null,
		});
		expect(profileACPLDistribution(shortResignation)).toEqual({
			acpl: null,
			stdDev: null,
			top1MatchRate: null,
			sampleSize: 10,
			flagged: false,
			flagType: null,
		});
	});

	it("excludes opening book moves (plies 1..8) and forced moves (isForced or legalMoveCount <= 1)", () => {
		const bookMoves = Array.from({ length: 8 }, (_, idx) => ({
			ply: idx + 1,
			bestEval: 500,
			playedEval: 0,
			isTop1: false,
		}));
		const forcedMoves = [
			{ ply: 9, bestEval: 300, playedEval: 0, isForced: true, isTop1: false },
			{ ply: 10, bestEval: 300, playedEval: 0, legalMoveCount: 1, isTop1: false },
		];
		const validMoves = Array.from({ length: 20 }, (_, idx) => ({
			ply: idx + 11,
			bestEval: 100,
			playedEval: 95,
			isTop1: true,
		}));

		const combined = [...bookMoves, ...forcedMoves, ...validMoves];
		const acpl = calculateACPL(combined);
		const profile = profileACPLDistribution(combined);

		expect(acpl).toBe(5);
		expect(profile.sampleSize).toBe(20);
		expect(profile.acpl).toBe(5);
		expect(profile.stdDev).toBe(0);
		expect(profile.top1MatchRate).toBe(1);
		expect(profile.flagged).toBe(true);
		expect(profile.flagType).toBe(ANTI_CHEAT_FLAG_SUSPICIOUS_ENGINE_ACCURACY);
	});

	it("integrates ACPL profiling into AntiCheatService.buildPlayerAnalysis", () => {
		const service = new AntiCheatService({ db: {}, games: {} });
		const humanDelays = [
			1200, 800, 2500, 600, 3100, 2800, 7200, 1300, 450, 3700,
			9000, 4300, 2200, 1800, 5600, 3100, 18000, 6400, 700, 11200,
			2500, 1100, 4900, 13800, 3400, 2100, 8700, 1500, 4200, 6100,
		];
		const telemetry = humanDelays.map((move_duration_ms, idx) => ({
			player_address: "GENGINE",
			move_duration_ms,
			event_data: { moveNumber: idx + 1, legalMoveCount: 25 },
		}));
		const engineResults = humanDelays.map((_, idx) => ({
			matchesTopMove: idx !== 12,
			centipawnLoss: idx === 12 ? 15 : 2,
		}));

		const analysis = service.buildPlayerAnalysis("white", "GENGINE", telemetry, engineResults, 1900);

		expect(analysis.acplProfile).toEqual(expect.objectContaining({
			sampleSize: 22,
			flagged: true,
			flagType: ANTI_CHEAT_FLAG_SUSPICIOUS_ENGINE_ACCURACY,
		}));
		expect(analysis.flagged).toBe(true);
		expect(analysis.antiCheatFlags).toEqual(expect.arrayContaining([
			expect.objectContaining({
				type: ANTI_CHEAT_FLAG_SUSPICIOUS_ENGINE_ACCURACY,
				sampleSize: 22,
			}),
		]));
		expect(analysis.reasons).toEqual(expect.arrayContaining([
			expect.stringContaining("FIDE ACPL"),
		]));
	});
});

describe("client tab visibility and blur telemetry tracking (Issue #794)", () => {
	const {
		assessBlurMoveCorrelation,
		analyzeTabSwitchingTelemetry,
		INTEGRITY_SUSPICIOUS_TAB_SWITCHING,
	} = require("../services/antiCheatService");

	it("correlates blur-focus sequence when away 2-10s and move submitted within 2s of focus", () => {
		const baseTime = 100000;
		const blurEvents = [
			{ eventType: "BLUR", timestamp: baseTime },
			{ eventType: "FOCUS", timestamp: baseTime + 3000 }, // away for 3s (within 1.5s - 15s)
		];
		const moveTimestamp = baseTime + 3800; // moved 800ms after focus (<= 2000ms)

		const isCorrelated = assessBlurMoveCorrelation(blurEvents, moveTimestamp);
		expect(isCorrelated).toBe(true);
	});

	it("does not flag quick casual blurs under 1.5s", () => {
		const baseTime = 100000;
		const blurEvents = [
			{ eventType: "BLUR", timestamp: baseTime },
			{ eventType: "FOCUS", timestamp: baseTime + 800 }, // away for only 800ms
		];
		const moveTimestamp = baseTime + 1200;

		const isCorrelated = assessBlurMoveCorrelation(blurEvents, moveTimestamp);
		expect(isCorrelated).toBe(false);
	});

	it("does not flag moves made long after focus returns (> 2s)", () => {
		const baseTime = 100000;
		const blurEvents = [
			{ eventType: "BLUR", timestamp: baseTime },
			{ eventType: "FOCUS", timestamp: baseTime + 4000 }, // away 4s
		];
		const moveTimestamp = baseTime + 8000; // moved 4s after focus

		const isCorrelated = assessBlurMoveCorrelation(blurEvents, moveTimestamp);
		expect(isCorrelated).toBe(false);
	});

	it("flags INTEGRITY_SUSPICIOUS_TAB_SWITCHING when correlated moves reach threshold", () => {
		const telemetry = [];
		const moves = [];
		let t = 100000;

		for (let i = 1; i <= 10; i++) {
			telemetry.push({ eventType: "BLUR", timestamp: t });
			telemetry.push({ eventType: "FOCUS", timestamp: t + 3000 });
			moves.push({ move_number: i, created_at: new Date(t + 3500).toISOString() });
			t += 10000;
		}

		const report = analyzeTabSwitchingTelemetry(telemetry, moves);
		expect(report.correlatedCount).toBe(10);
		expect(report.suspicious).toBe(true);
		expect(report.flag).toBe(INTEGRITY_SUSPICIOUS_TAB_SWITCHING);
	});
});
