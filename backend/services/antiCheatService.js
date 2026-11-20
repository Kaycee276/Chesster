const supabase = require("../config/supabase");
const botService = require("./botService");
const gameModel = require("../models/gameModel");
const chessEngine = require("./chessEngine");
const { boardToFEN } = require("./botService");

const FLAG_THRESHOLD = 0.85;
const MIN_TIMED_MOVES = 5;
const ACPL_WINDOW_SIZE = 10;
const ENGINE_STREAK_MAX_ACPL = 5;
const ENGINE_STREAK_MIN_CORRELATION = 0.9;

// Move time variance entropy (Issue #461). Think times are binned into
// logarithmic intervals: 0-1s, 1-2s, 2-4s, 4-8s, 8-16s and >16s.
const ENTROPY_BIN_EDGES_MS = [1000, 2000, 4000, 8000, 16000];
const ENTROPY_BIN_COUNT = ENTROPY_BIN_EDGES_MS.length + 1;
const OPENING_BOOK_MOVES = 5;
const MIN_ENTROPY_SAMPLES = 10;
const LOW_ENTROPY_THRESHOLD = 0.35;
const HIGH_ENTROPY_THRESHOLD = 0.95;
const HIGH_ENTROPY_MIN_ENGINE_CORRELATION = 0.9;
const ANTI_CHEAT_FLAG_LOW_ENTROPY = "low_time_variance_entropy";
const ANTI_CHEAT_FLAG_HIGH_ENTROPY = "high_time_variance_entropy_engine_correlation";

// Instant tactical refutation heuristic (Issue #643). A reply to a volatile
// position (the opponent's last move swung the eval by more than 200cp) that
// is the engine's top line, is chosen among many legal moves and is played in
// under 300ms is a bot hallmark; humans stop to evaluate such positions.
const TACTICAL_BURST_FLAG = "TACTICAL_BURST_FLAG";
const TACTICAL_EVAL_SWING_CP = 200;
const TACTICAL_MIN_LEGAL_MOVES = 15;
const TACTICAL_BURST_MAX_MS = 300;
const TACTICAL_MIN_BURSTS = 2;
const TACTICAL_BURST_SCORE_STEP = 10;
const TACTICAL_BURST_SCORE_MAX = 40;

// Mouse trajectory biometric verification (Issue #682).
const MOUSE_TRAJECTORY_FLAG = "SYNTHETIC_INPUT_FLAG";
const MIN_TRAJECTORY_POINTS = 5;
const SYNTHETIC_LINEARITY_THRESHOLD = 0.999;
const MICRO_JITTER_THRESHOLD = 0.05;
const HUMAN_MAX_VELOCITY_PX_S = 5000;

function mean(values) {
	return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function standardDeviation(values) {
	if (values.length === 0) return 0;
	const average = mean(values);
	return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function percentile(values, quantile) {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * quantile))];
}

function calculateTimingEntropy(moveDurationsMs) {
	if (moveDurationsMs.length < MIN_TIMED_MOVES) return 1;
	const average = mean(moveDurationsMs);
	return average > 0 ? standardDeviation(moveDurationsMs) / average : 0;
}

function calculateVariance(values) {
	if (!values || values.length === 0) return 0;
	const avg = mean(values);
	return mean(values.map((v) => (v - avg) ** 2));
}

/**
 * Pearson correlation coefficient R between two equal-length arrays.
 * Returns 0 if either array has zero variance or if lengths < 2.
 */
function calculatePearsonCorrelation(x, y) {
	if (!x || !y || x.length !== y.length || x.length < 2) return 0;
	const n = x.length;
	const avgX = mean(x);
	const avgY = mean(y);
	let num = 0;
	let denX = 0;
	let denY = 0;
	for (let i = 0; i < n; i++) {
		const dx = x[i] - avgX;
		const dy = y[i] - avgY;
		num += dx * dy;
		denX += dx * dx;
		denY += dy * dy;
	}
	const den = Math.sqrt(denX * denY);
	if (den === 0) return 0;
	return Number((num / den).toFixed(4));
}

/**
 * Compute move time entropy variance to flag programmatic bot play (Issue #553).
 *
 * @param {Array<number>} moveTimes - Deliberation durations per move (seconds or ms)
 * @param {Array<number|object>} [evaluations=[]] - Evaluation scores or objects with centipawnLoss / delta
 * @param {object} [options]
 * @param {number} [options.varianceThreshold=0.05] - Threshold for suspicious low variance
 * @param {number} [options.minMoves=15] - Minimum moves to flag suspect timing
 * @returns {{
 *   isSuspectTiming: boolean,
 *   timingVariance: number,
 *   entropyScore: number,
 *   complexityCorrelation: number,
 *   flagReason: string|null
 * }}
 */
function analyzeMoveTimeDistribution(moveTimes = [], evaluations = [], options = {}) {
	const validMoveTimes = (moveTimes || [])
		.map(toFiniteNumber)
		.filter((t) => t !== null && t >= 0);

	const minMoves = options.minMoves ?? 15;
	const varianceThreshold = options.varianceThreshold ?? 0.05;

	// If timestamps/durations are in ms (> 100 on average), scale to seconds for consistent variance check
	const avgTime = mean(validMoveTimes);
	const isMs = avgTime > 100;
	const timesInSec = isMs ? validMoveTimes.map((t) => t / 1000) : validMoveTimes;

	const timingVariance = Number(calculateVariance(timesInSec).toFixed(4));

	// Shannon entropy score over binned move durations (normalized 0..1)
	const timesInMs = isMs ? validMoveTimes : validMoveTimes.map((t) => t * 1000);
	const entropyScore = moveTimeEntropyScore(timesInMs) ?? 0;

	// Calculate Move-Time Complexity Correlation (R_tc):
	// Pearson correlation between position evaluation delta |Δeval_i| and move time t_i.
	let evalDeltas = [];
	if (Array.isArray(evaluations) && evaluations.length > 0) {
		const numericEvals = evaluations.map((ev) => {
			if (typeof ev === "number") return ev;
			if (ev && typeof ev.eval === "number") return ev.eval;
			if (ev && typeof ev.centipawnLoss === "number") return ev.centipawnLoss;
			if (ev && typeof ev.scoreCp === "number") return ev.scoreCp;
			return null;
		});

		if (numericEvals.length === validMoveTimes.length) {
			// Pre-calculated per-move eval or delta
			evalDeltas = numericEvals.map((v) => Math.abs(v ?? 0));
		} else {
			// Compute sequential deltas: |eval[i] - eval[i-1]|
			for (let i = 0; i < numericEvals.length; i++) {
				if (i === 0) {
					evalDeltas.push(Math.abs(numericEvals[0] ?? 0));
				} else {
					evalDeltas.push(Math.abs((numericEvals[i] ?? 0) - (numericEvals[i - 1] ?? 0)));
				}
			}
		}
	}

	// Truncate or pad to match moveTimes length
	const count = Math.min(timesInSec.length, evalDeltas.length);
	const complexityCorrelation = count >= 2
		? calculatePearsonCorrelation(evalDeltas.slice(0, count), timesInSec.slice(0, count))
		: 0;

	const isSuspectTiming = validMoveTimes.length >= minMoves && (timingVariance < varianceThreshold || entropyScore < LOW_ENTROPY_THRESHOLD);
	let flagReason = null;
	if (isSuspectTiming) {
		if (timingVariance < varianceThreshold && entropyScore < LOW_ENTROPY_THRESHOLD) {
			flagReason = "Low move time variance and anomalous entropy indicate automated bot timing";
		} else if (timingVariance < varianceThreshold) {
			flagReason = "Low move time variance indicates automated bot timing";
		} else {
			flagReason = "Anomalously low move time entropy profile indicates automated bot timing";
		}
	}

	return {
		isSuspectTiming,
		timingVariance,
		entropyScore,
		complexityCorrelation,
		flagReason,
	};
}

function toFiniteNumber(value) {
	if (value === null || value === undefined || value === "") return null;
	const number = Number(value);
	return Number.isFinite(number) ? number : null;
}

/** Index of the logarithmic interval a think time falls into. */
function binMoveDuration(durationMs) {
	const index = ENTROPY_BIN_EDGES_MS.findIndex((edge) => durationMs < edge);
	return index === -1 ? ENTROPY_BIN_EDGES_MS.length : index;
}

function moveTimeHistogram(durationsMs) {
	const counts = new Array(ENTROPY_BIN_COUNT).fill(0);
	for (const duration of durationsMs) counts[binMoveDuration(duration)] += 1;
	return counts;
}

/**
 * Shannon entropy H = -sum(p_k * log2(p_k)) of think times over the
 * logarithmic bins, normalised by log2(K) to a 0..1 score. Returns null when
 * there are no samples.
 */
function moveTimeEntropyScore(durationsMs) {
	const samples = durationsMs.filter((value) => Number.isFinite(value) && value >= 0);
	if (samples.length === 0) return null;
	let entropy = 0;
	for (const count of moveTimeHistogram(samples)) {
		if (count === 0) continue;
		const p = count / samples.length;
		entropy -= p * Math.log2(p);
	}
	return Number((entropy / Math.log2(ENTROPY_BIN_COUNT)).toFixed(4));
}

/**
 * Normalised move time entropy from ordered move timestamps (ms): the delay
 * before each move is t_i = timestamp[i] - timestamp[i-1].
 */
function calculateMoveTimeEntropy(timestamps) {
	const values = (timestamps || []).map(toFiniteNumber).filter((value) => value !== null);
	const delays = [];
	for (let i = 1; i < values.length; i += 1) delays.push(Math.max(0, values[i] - values[i - 1]));
	return moveTimeEntropyScore(delays);
}

/** Legal moves for `color`, counting at most `limit` (forced-move detection). */
function countLegalMoves(board, color, limit = Infinity) {
	if (!Array.isArray(board) || board.length !== 8) return null;
	let count = 0;
	for (let r = 0; r < 8; r += 1) {
		for (let c = 0; c < 8; c += 1) {
			const piece = board[r][c];
			if (!piece || piece === "." || (piece === piece.toUpperCase()) !== (color === "white")) continue;
			for (let tr = 0; tr < 8; tr += 1) {
				for (let tc = 0; tc < 8; tc += 1) {
					if (chessEngine.isValidMove(board, [r, c], [tr, tc], color).valid) {
						count += 1;
						if (count >= limit) return count;
					}
				}
			}
		}
	}
	return count;
}

/** Legal move count (capped at 2) for the position a telemetry move was played from. */
function forcedMoveCount(eventData) {
	if (!eventData) return null;
	if (eventData.legalMoveCount !== undefined) return toFiniteNumber(eventData.legalMoveCount);
	try {
		return countLegalMoves(eventData.boardBefore, eventData.color, 2);
	} catch {
		return null;
	}
}

/**
 * Think time before every move in a game history (both colours, in order).
 * The server-measured move_duration_ms is preferred; otherwise the delay is
 * derived from consecutive move timestamps.
 */
function extractMoveDelays(moveHistory = []) {
	let previousTimestamp = null;
	return moveHistory.map((entry) => {
		const timestamp = toFiniteNumber(entry.timestamp ?? entry.move_timestamp_ms);
		const duration = toFiniteNumber(entry.durationMs ?? entry.move_duration_ms);
		let delayMs = null;
		if (duration !== null && duration >= 0) delayMs = duration;
		else if (timestamp !== null && previousTimestamp !== null) delayMs = Math.max(0, timestamp - previousTimestamp);
		if (timestamp !== null) previousTimestamp = timestamp;
		return {
			color: entry.color ?? entry.event_data?.color ?? null,
			delayMs,
			legalMoveCount: toFiniteNumber(entry.legalMoveCount ?? entry.event_data?.legalMoveCount),
		};
	});
}

/**
 * Entropy summary for one player's ordered move delays. Opening book moves
 * (the player's first five) and forced moves (a single legal reply) are
 * excluded because they carry no timing signal.
 */
function summarizeMoveTimeEntropy(delays) {
	const samples = [];
	let excludedMoves = 0;
	delays.forEach((delay, index) => {
		const forced = delay.legalMoveCount !== null && delay.legalMoveCount <= 1;
		if (index < OPENING_BOOK_MOVES || forced || delay.delayMs === null) {
			excludedMoves += 1;
			return;
		}
		samples.push(delay.delayMs);
	});
	return {
		sampleCount: samples.length,
		excludedMoves,
		histogram: moveTimeHistogram(samples),
		timeVarianceEntropyScore: samples.length >= MIN_ENTROPY_SAMPLES ? moveTimeEntropyScore(samples) : null,
	};
}

/** Telemetry flags raised by a move time entropy score. */
function entropyFlags(entropyScore, engineCorrelation) {
	if (entropyScore === null || entropyScore === undefined) return [];
	if (entropyScore < LOW_ENTROPY_THRESHOLD) {
		return [{ type: ANTI_CHEAT_FLAG_LOW_ENTROPY, timeVarianceEntropyScore: entropyScore, threshold: LOW_ENTROPY_THRESHOLD }];
	}
	if (entropyScore > HIGH_ENTROPY_THRESHOLD && engineCorrelation !== null && engineCorrelation > HIGH_ENTROPY_MIN_ENGINE_CORRELATION) {
		return [{
			type: ANTI_CHEAT_FLAG_HIGH_ENTROPY,
			timeVarianceEntropyScore: entropyScore,
			threshold: HIGH_ENTROPY_THRESHOLD,
			engineCorrelation: Number(engineCorrelation.toFixed(4)),
		}];
	}
	return [];
}

/**
 * Per-player move time variance entropy for a whole game.
 * @param {object[]} moveHistory - moves in game order with `color` and a
 *   `timestamp` (or `durationMs`); `legalMoveCount` marks forced moves.
 * @param {{engineCorrelation?: {white?: number, black?: number}}} [options]
 */
function analyzeGameMoveTimes(moveHistory, { engineCorrelation = {} } = {}) {
	const delays = extractMoveDelays(moveHistory);
	const result = {};
	for (const color of ["white", "black"]) {
		const summary = summarizeMoveTimeEntropy(delays.filter((delay) => delay.color === color));
		const correlation = toFiniteNumber(engineCorrelation[color]);
		const flags = entropyFlags(summary.timeVarianceEntropyScore, correlation);
		result[color] = { ...summary, flags, flagged: flags.length > 0 };
	}
	return result;
}

/**
 * Classify whether a position is complex enough for response speed to be
 * meaningful. Forced replies (one legal move, e.g. a recapture) and quiet
 * positions are excluded because they are naturally played quickly.
 * priorMoveEvalDiff is the centipawn swing caused by the opponent's last move.
 * @returns {{complex: boolean, reason: string}}
 */
function evaluateMoveComplexity({ legalMovesCount, priorMoveEvalDiff } = {}) {
	const legal = toFiniteNumber(legalMovesCount);
	const swing = toFiniteNumber(priorMoveEvalDiff);
	if (legal === null || swing === null) return { complex: false, reason: "insufficient_data" };
	if (legal <= 1) return { complex: false, reason: "forced_move" };
	if (legal <= TACTICAL_MIN_LEGAL_MOVES) return { complex: false, reason: "few_legal_moves" };
	if (Math.abs(swing) <= TACTICAL_EVAL_SWING_CP) return { complex: false, reason: "low_volatility" };
	return { complex: true, reason: "high_tactical_volatility" };
}

/**
 * Flag a single move if it is an instant engine-top reply in a complex position.
 * @param {{isTopEngineMove: boolean, durationMs: number|null, moveNumber?: number}} moveData
 * @returns {{type: string, flag: string, severity: string, moveNumber: number|null, durationMs: number}|null}
 */
function evaluateTacticalResponse(moveData, priorMoveEvalDiff, legalMovesCount) {
	if (!moveData || moveData.isTopEngineMove !== true) return null;
	const durationMs = toFiniteNumber(moveData.durationMs);
	if (durationMs === null || durationMs < 0 || durationMs >= TACTICAL_BURST_MAX_MS) return null;
	if (!evaluateMoveComplexity({ legalMovesCount, priorMoveEvalDiff }).complex) return null;
	return {
		type: TACTICAL_BURST_FLAG,
		flag: TACTICAL_BURST_FLAG,
		severity: "high",
		moveNumber: toFiniteNumber(moveData.moveNumber),
		durationMs,
	};
}

/**
 * Scan one player's moves for repeated instant tactical refutations. A single
 * fast reply is not enough: at least TACTICAL_MIN_BURSTS complex positions in
 * the match must be answered instantly with the engine's top move.
 * Each move: {moveNumber, durationMs, isTopEngineMove, priorMoveEvalDiff, legalMovesCount}.
 * @returns {{bursts: object[], complexMoves: number, flags: object[], suspicionBoost: number}}
 */
function detectInstantTacticalRefutations(moves = []) {
	const bursts = [];
	let complexMoves = 0;
	for (const move of moves || []) {
		if (!move) continue;
		if (evaluateMoveComplexity(move).complex) complexMoves += 1;
		const flag = evaluateTacticalResponse(move, move.priorMoveEvalDiff, move.legalMovesCount);
		if (flag) bursts.push(flag);
	}
	if (bursts.length < TACTICAL_MIN_BURSTS) return { bursts, complexMoves, flags: [], suspicionBoost: 0 };
	return {
		bursts,
		complexMoves,
		flags: [{
			type: TACTICAL_BURST_FLAG,
			flag: TACTICAL_BURST_FLAG,
			severity: "high",
			burstCount: bursts.length,
			complexMoves,
			thresholdMs: TACTICAL_BURST_MAX_MS,
			moveNumbers: bursts.map((burst) => burst.moveNumber),
		}],
		suspicionBoost: Math.min(TACTICAL_BURST_SCORE_MAX, bursts.length * TACTICAL_BURST_SCORE_STEP),
	};
}

function summarizeCentipawnLoss(losses) {
	return {
		count: losses.length,
		mean: losses.length ? Math.round(mean(losses)) : null,
		median: percentile(losses, 0.5),
		p90: percentile(losses, 0.9),
	};
}

function computeWindowedCentipawnLoss(evaluations, windowSize = ACPL_WINDOW_SIZE) {
	if (!Number.isInteger(windowSize) || windowSize < 1) return [];
	const windows = [];
	for (let start = 0; start <= evaluations.length - windowSize; start += 1) {
		const slice = evaluations.slice(start, start + windowSize);
		if (slice.some((evaluation) => !evaluation || evaluation.centipawnLoss == null || !Number.isFinite(Number(evaluation.centipawnLoss)))) continue;
		const averageCentipawnLoss = mean(slice.map((evaluation) => Number(evaluation.centipawnLoss)));
		const engineMatchRate = slice.filter((evaluation) => evaluation.matchesTopMove === true).length / windowSize;
		windows.push({ start, end: start + windowSize - 1, averageCentipawnLoss, engineMatchRate });
	}
	return windows;
}

function calculateAnomalyScore({ moveDurationsMs, engineMatches, centipawnLosses }) {
	const timingRegularity = moveDurationsMs.length >= MIN_TIMED_MOVES
		? 1 - Math.min(1, calculateTimingEntropy(moveDurationsMs))
		: 0;
	const engineCorrelation = engineMatches.length
		? engineMatches.filter(Boolean).length / engineMatches.length
		: 0;
	const cpl = summarizeCentipawnLoss(centipawnLosses);
	const engineAccuracy = cpl.median == null ? 0 : 1 - Math.min(1, cpl.median / 200);
	return Number(Math.min(1, timingRegularity * 0.4 + engineCorrelation * 0.5 + engineAccuracy * 0.1).toFixed(4));
}

function coordsToSquare(coords) {
	if (!Array.isArray(coords) || coords.length !== 2) return "";
	return `${String.fromCharCode("a".charCodeAt(0) + coords[1])}${8 - coords[0]}`;
}

function moveToUci(move) {
	return `${coordsToSquare(move.from)}${coordsToSquare(move.to)}${move.promotion || ""}`;
}

class AntiCheatService {
	constructor({ db = supabase, engine = botService, games = gameModel, audit = null, logger = console } = {}) {
		this.db = db;
		this.engine = engine;
		this.games = games;
		this.audit = audit;
		this.logger = logger;
		this.pendingTelemetry = new Map();
	}

	recordMove(payload) {
		const previous = this.pendingTelemetry.get(payload.gameId) || Promise.resolve();
		const write = previous.then(() => this._recordMove(payload));
		this.pendingTelemetry.set(payload.gameId, write);
		const clearPending = () => {
			if (this.pendingTelemetry.get(payload.gameId) === write) {
				this.pendingTelemetry.delete(payload.gameId);
			}
		};
		write.then(clearPending, clearPending);
		return write;
	}

	async _recordMove({ gameId, gameCode, color, playerAddress, moveNumber, move, boardBefore, boardAfter, turnStartedAt }) {
		const timestampMs = Date.now();
		const startedMs = Date.parse(turnStartedAt);
		const durationMs = Number.isFinite(startedMs) ? Math.max(0, timestampMs - startedMs) : null;
		const { error } = await this.db.from("match_audit_logs").insert({
			game_id: gameId,
			event_type: "move.submitted",
			player_address: playerAddress,
			move_timestamp_ms: timestampMs,
			move_duration_ms: durationMs,
			event_data: {
				gameCode,
				color,
				moveNumber,
				move,
				boardBefore,
				boardAfter,
			},
		});
		if (error) throw error;
		return { timestampMs, durationMs };
	}

	/**
	 * Log a move timing burst / forged premove attempt to `anti_cheat_logs`
	 * (Issue #583). Telemetry must never block or fail move handling, so errors
	 * are logged and swallowed.
	 *
	 * @returns {Promise<boolean>} true if the row was written
	 */
	async logMoveBurst({ gameCode, walletAddress, ip, deltaMs, reason }) {
		try {
			const { error } = await this.db.from("anti_cheat_logs").insert({
				game_code: gameCode,
				wallet_address: walletAddress || null,
				ip_address: ip || null,
				delta_ms: Number.isFinite(deltaMs) ? Math.round(deltaMs) : null,
				reason,
			});
			if (error) throw error;
			return true;
		} catch (error) {
			this.logger.warn(`[AntiCheat] burst telemetry failed: ${error.message}`);
			return false;
		}
	}

	async getTelemetry(gameId) {
		const { data, error } = await this.db
			.from("match_audit_logs")
			.select("id, player_address, move_timestamp_ms, move_duration_ms, event_data")
			.eq("game_id", gameId)
			.eq("event_type", "move.submitted")
			.order("move_timestamp_ms", { ascending: true });
		if (error) throw error;
		return data || [];
	}

	async analyzeEngineMove(telemetry) {
		const event = telemetry.event_data;
		const moveNumber = Number(event.moveNumber) || 1;
		const beforeFen = boardToFEN(event.boardBefore, event.color, moveNumber - 1);
		const afterColor = event.color === "white" ? "black" : "white";
		const afterFen = boardToFEN(event.boardAfter, afterColor, moveNumber);
		const before = await this.engine.analyzeFen(beforeFen, 16);
		const after = await this.engine.analyzeFen(afterFen, 16);
		const playedMove = moveToUci(event.move);
		const centipawnLoss = before.scoreCp == null || after.scoreCp == null
			? null
			: Math.max(0, Math.min(100000, before.scoreCp + after.scoreCp));

		await this.db.from("match_audit_logs").update({
			engine_top_move: before.bestMove,
			centipawn_loss: centipawnLoss,
		}).eq("id", telemetry.id);

		return {
			matchesTopMove: playedMove === before.bestMove,
			centipawnLoss,
			evalBeforeCp: Number.isFinite(before.scoreCp) ? before.scoreCp : null,
		};
	}

	/**
	 * Per-move inputs for the tactical refutation heuristic: each of `color`'s
	 * moves paired with the eval swing of the opponent move that preceded it.
	 * evalBeforeCp is from the mover's view, so the opponent's move swung the
	 * eval by |evalBefore(previous) + evalBefore(this)|.
	 */
	collectTacticalMoves(telemetry, color, engineByEntry) {
		const moves = [];
		telemetry.forEach((entry, index) => {
			const event = entry.event_data;
			const previous = telemetry[index - 1];
			if (event?.color !== color || !previous || previous.event_data?.color === color) return;
			const current = engineByEntry.get(entry);
			const prior = engineByEntry.get(previous);
			const hasEvals = Number.isFinite(current?.evalBeforeCp) && Number.isFinite(prior?.evalBeforeCp);
			let legalMovesCount = null;
			try {
				legalMovesCount = toFiniteNumber(event.legalMoveCount)
					?? countLegalMoves(event.boardBefore, color, TACTICAL_MIN_LEGAL_MOVES + 1);
			} catch {
				legalMovesCount = null;
			}
			moves.push({
				moveNumber: toFiniteNumber(event.moveNumber),
				durationMs: toFiniteNumber(entry.move_duration_ms),
				isTopEngineMove: current?.matchesTopMove === true,
				priorMoveEvalDiff: hasEvals ? current.evalBeforeCp + prior.evalBeforeCp : null,
				legalMovesCount,
			});
		});
		return moves;
	}

	buildPlayerAnalysis(color, playerAddress, telemetry, engineResults, rating = null, timing = null, tactical = null) {
		const durations = telemetry
			.map((entry) => entry.move_duration_ms)
			.filter((value) => Number.isFinite(value) && value >= 0);
		const validEngineResults = engineResults.filter(Boolean);
		const engineMatches = validEngineResults.map((result) => result.matchesTopMove);
		const centipawnLosses = validEngineResults
			.map((result) => result.centipawnLoss)
			.filter((value) => Number.isFinite(value));
		const averageMoveMs = durations.length ? Math.round(mean(durations)) : null;
		const stdDevMoveMs = durations.length ? Math.round(standardDeviation(durations)) : null;
		const score = calculateAnomalyScore({
			moveDurationsMs: durations,
			engineMatches,
			centipawnLosses,
		});
		const hasRating = rating !== null && rating !== undefined && Number.isFinite(Number(rating));
		const evaluationWindows = computeWindowedCentipawnLoss(engineResults);
		const suspiciousEngineWindow = evaluationWindows.find((window) =>
			hasRating && Number(rating) < 1500 &&
			window.averageCentipawnLoss < ENGINE_STREAK_MAX_ACPL &&
			window.engineMatchRate > ENGINE_STREAK_MIN_CORRELATION
		);
		const ratingRisk = hasRating ? Math.max(0, Math.min(1, (2000 - Number(rating)) / 1200)) : 0;
		const suspicionScore = Math.round(Math.min(100, Math.max(0,
			(tactical?.suspicionBoost || 0) +
			score * 35 +
			(engineMatches.length ? engineMatches.filter(Boolean).length / engineMatches.length : 0) * 40 +
			(centipawnLosses.length ? Math.max(0, 1 - mean(centipawnLosses) / 200) : 0) * 15 +
			ratingRisk * 10,
		)));

		const reasons = [];
		if (durations.length >= MIN_TIMED_MOVES && calculateTimingEntropy(durations) < 0.15) {
			reasons.push("highly uniform move timing");
		}
		const engineCorrelation = engineMatches.length
			? engineMatches.filter(Boolean).length / engineMatches.length
			: null;
		if (engineCorrelation != null && engineCorrelation >= 0.9) {
			reasons.push("at least 90% correlation with Stockfish top moves");
		}
		if (suspiciousEngineWindow) reasons.push("low-rated player has a 10-move engine-like ACPL streak");

		const moveTiming = timing || summarizeMoveTimeEntropy(extractMoveDelays(telemetry));
		const antiCheatFlags = entropyFlags(moveTiming.timeVarianceEntropyScore, engineCorrelation);
		for (const flag of antiCheatFlags) {
			reasons.push(flag.type === ANTI_CHEAT_FLAG_LOW_ENTROPY
				? "suspiciously uniform move time distribution (low time variance entropy)"
				: "near-maximal move time entropy with over 90% engine correlation");
		}
		for (const flag of tactical?.flags || []) {
			antiCheatFlags.push(flag);
			reasons.push(`${flag.burstCount} instant (under ${TACTICAL_BURST_MAX_MS}ms) engine-top replies to complex tactical positions`);
		}

		return {
			color,
			playerAddress,
			moveCount: telemetry.length,
			averageMoveMs,
			stdDevMoveMs,
			timingEntropy: Number(calculateTimingEntropy(durations).toFixed(4)),
			engineCorrelation: engineCorrelation == null ? null : Number(engineCorrelation.toFixed(4)),
			engineMatchRate: engineCorrelation == null ? null : Number(engineCorrelation.toFixed(4)),
			centipawnLoss: summarizeCentipawnLoss(centipawnLosses),
			evaluationWindows,
			rating: hasRating ? Number(rating) : null,
			timeVarianceEntropyScore: moveTiming.timeVarianceEntropyScore,
			moveTimeHistogram: moveTiming.histogram,
			entropySampleCount: moveTiming.sampleCount,
			antiCheatFlags,
			suspicionScore,
			score,
			flagged: score > FLAG_THRESHOLD || Boolean(suspiciousEngineWindow) || antiCheatFlags.length > 0,
			reasons,
		};
	}

	async analyzeGame(gameId) {
		const pendingWrite = this.pendingTelemetry.get(gameId);
		if (pendingWrite) await pendingWrite;
		const telemetry = await this.getTelemetry(gameId);
		let ratings = { white: null, black: null };
		try {
			const { data: game, error: gameError } = await this.db.from("games")
				.select("player_white_address, player_black_address").eq("id", gameId).maybeSingle();
			if (gameError) throw gameError;
			for (const color of ["white", "black"]) {
				const address = game?.[`player_${color}_address`];
				if (!address) continue;
				const { data: player, error } = await this.db.from("players")
					.select("elo_rating").eq("wallet_address", address).maybeSingle();
				if (error) throw error;
				ratings[color] = player?.elo_rating !== null && player?.elo_rating !== undefined && Number.isFinite(Number(player.elo_rating))
					? Number(player.elo_rating)
					: null;
			}
		} catch (error) {
			this.logger.warn(`[AntiCheat] Player ratings unavailable: ${error.message}`);
		}
		const grouped = { white: [], black: [] };
		for (const entry of telemetry) {
			const color = entry.event_data?.color;
			if (grouped[color]) grouped[color].push(entry);
		}
		const moveTimes = analyzeGameMoveTimes(telemetry.map((entry) => ({
			color: entry.event_data?.color,
			timestamp: entry.move_timestamp_ms,
			durationMs: entry.move_duration_ms,
			legalMoveCount: forcedMoveCount(entry.event_data),
		})));

		const analysis = {};
		const engineByEntry = new Map();
		for (const color of ["white", "black"]) {
			const entries = grouped[color];
			const engineResults = [];
			for (const entry of entries) {
				let result = null;
				try {
					result = await this.analyzeEngineMove(entry);
				} catch (error) {
					this.logger.warn(`[AntiCheat] Engine analysis skipped: ${error.message}`);
				}
				engineByEntry.set(entry, result);
				engineResults.push(result);
			}
			analysis[color] = this.buildPlayerAnalysis(
				color,
				entries[0]?.player_address || null,
				entries,
				engineResults,
				ratings[color],
				moveTimes[color],
				detectInstantTacticalRefutations(this.collectTacticalMoves(telemetry, color, engineByEntry)),
			);
		}

		await this.games.recordCheatAnalysis(gameId, analysis);
		return analysis;
	}

	/**
	 * Analyze cursor telemetry for synthetic input signatures. Detects bot automation
	 * by measuring trajectory linearity, micro-jitter variance, and instant jumps.
	 * Returns flags and suspicion score for accumulation in Game.anti_cheat_flags.
	 */
	analyzeCursorTelemetry(points, isMobileTouch = false) {
		if (!points || points.length < MIN_TRAJECTORY_POINTS) {
			return { isSynthetic: false, linearity: 0, avgJitter: 0, flagReason: null };
		}

		// Mobile touch events bypass cursor linearity tests (distinct tap signatures).
		if (isMobileTouch) {
			return { isSynthetic: false, linearity: 0, avgJitter: 0, flagReason: "mobile_touch_bypass" };
		}

		const linearity = this.calculateTrajectoryLinearity(points);
		const jitter = this.calculateMicroJitter(points);
		const hasInstantJump = this.detectInstantTeleportation(points);

		const isSynthetic = linearity > SYNTHETIC_LINEARITY_THRESHOLD && jitter < MICRO_JITTER_THRESHOLD && !hasInstantJump;

		return {
			isSynthetic,
			linearity: Number(linearity.toFixed(4)),
			avgJitter: Number(jitter.toFixed(4)),
			hasInstantJump,
			flagReason: isSynthetic ? MOUSE_TRAJECTORY_FLAG : null,
		};
	}

	calculateTrajectoryLinearity(points) {
		if (points.length < 3) return 0;

		// Fit a straight line through the points and calculate R² (coefficient of determination).
		const xs = points.map((p) => p.x);
		const ys = points.map((p) => p.y);

		const n = xs.length;
		const sumX = xs.reduce((a, b) => a + b, 0);
		const sumY = ys.reduce((a, b) => a + b, 0);
		const sumXY = xs.reduce((sum, x, i) => sum + x * ys[i], 0);
		const sumX2 = xs.reduce((sum, x) => sum + x * x, 0);
		const sumY2 = ys.reduce((sum, y) => sum + y * y, 0);

		const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
		const intercept = (sumY - slope * sumX) / n;

		const ssRes = ys.reduce((sum, y, i) => {
			const predicted = slope * xs[i] + intercept;
			return sum + (y - predicted) ** 2;
		}, 0);

		const ssTot = ys.reduce((sum, y) => sum + (y - sumY / n) ** 2, 0);

		return ssTot === 0 ? 0 : 1 - ssRes / ssTot;
	}

	calculateMicroJitter(points) {
		if (points.length < 3) return 0;

		let totalJitterVariance = 0;
		for (let i = 2; i < points.length; i++) {
			const dx1 = points[i - 1].x - points[i - 2].x;
			const dy1 = points[i - 1].y - points[i - 2].y;
			const dx2 = points[i].x - points[i - 1].x;
			const dy2 = points[i].y - points[i - 1].y;

			const accel1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
			const accel2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
			totalJitterVariance += Math.abs(accel2 - accel1);
		}

		return totalJitterVariance / (points.length - 2);
	}

	detectInstantTeleportation(points) {
		if (points.length < 2) return false;

		for (let i = 1; i < points.length; i++) {
			const dx = points[i].x - points[i - 1].x;
			const dy = points[i].y - points[i - 1].y;
			const distance = Math.sqrt(dx * dx + dy * dy);

			const timeDeltaMs = (points[i].t || 0) - (points[i - 1].t || 0);
			const timeInSeconds = timeDeltaMs / 1000;

			if (timeInSeconds > 0 && distance / timeInSeconds > HUMAN_MAX_VELOCITY_PX_S) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Full post-game inspection: runs the analysis (persisting scores, review
	 * flags and anti_cheat_flags) and dispatches an audit alert for every
	 * player with a move time entropy violation.
	 */
	async inspectGameSession(gameId) {
		const analysis = await this.analyzeGame(gameId);
		const audit = this.audit || require("./auditService");
		for (const color of ["white", "black"]) {
			const player = analysis[color];
			if (!player?.antiCheatFlags?.length) continue;
			try {
				await audit.recordAntiCheatAlert({
					gameId,
					color,
					playerAddress: player.playerAddress,
					flags: player.antiCheatFlags,
					timeVarianceEntropyScore: player.timeVarianceEntropyScore,
					engineCorrelation: player.engineCorrelation,
				});
			} catch (error) {
				this.logger.warn(`[AntiCheat] audit alert failed for ${color}: ${error.message}`);
			}
		}
		return analysis;
	}
}

module.exports = new AntiCheatService();
module.exports.AntiCheatService = AntiCheatService;
module.exports.FLAG_THRESHOLD = FLAG_THRESHOLD;
module.exports.calculateTimingEntropy = calculateTimingEntropy;
module.exports.calculateAnomalyScore = calculateAnomalyScore;
module.exports.summarizeCentipawnLoss = summarizeCentipawnLoss;
module.exports.computeWindowedCentipawnLoss = computeWindowedCentipawnLoss;
module.exports.moveToUci = moveToUci;
module.exports.calculateMoveTimeEntropy = calculateMoveTimeEntropy;
module.exports.moveTimeEntropyScore = moveTimeEntropyScore;
module.exports.binMoveDuration = binMoveDuration;
module.exports.countLegalMoves = countLegalMoves;
module.exports.analyzeGameMoveTimes = analyzeGameMoveTimes;
module.exports.analyzeMoveTimeDistribution = analyzeMoveTimeDistribution;
module.exports.calculateVariance = calculateVariance;
module.exports.evaluateMoveComplexity = evaluateMoveComplexity;
module.exports.evaluateTacticalResponse = evaluateTacticalResponse;
module.exports.detectInstantTacticalRefutations = detectInstantTacticalRefutations;
module.exports.TACTICAL_BURST_FLAG = TACTICAL_BURST_FLAG;
module.exports.TACTICAL_BURST_MAX_MS = TACTICAL_BURST_MAX_MS;
module.exports.TACTICAL_EVAL_SWING_CP = TACTICAL_EVAL_SWING_CP;
module.exports.TACTICAL_MIN_LEGAL_MOVES = TACTICAL_MIN_LEGAL_MOVES;
module.exports.TACTICAL_MIN_BURSTS = TACTICAL_MIN_BURSTS;
module.exports.calculatePearsonCorrelation = calculatePearsonCorrelation;
module.exports.ENTROPY_BIN_EDGES_MS = ENTROPY_BIN_EDGES_MS;
module.exports.LOW_ENTROPY_THRESHOLD = LOW_ENTROPY_THRESHOLD;
module.exports.HIGH_ENTROPY_THRESHOLD = HIGH_ENTROPY_THRESHOLD;
module.exports.MIN_ENTROPY_SAMPLES = MIN_ENTROPY_SAMPLES;
module.exports.OPENING_BOOK_MOVES = OPENING_BOOK_MOVES;
module.exports.MOUSE_TRAJECTORY_FLAG = MOUSE_TRAJECTORY_FLAG;
module.exports.MIN_TRAJECTORY_POINTS = MIN_TRAJECTORY_POINTS;
module.exports.SYNTHETIC_LINEARITY_THRESHOLD = SYNTHETIC_LINEARITY_THRESHOLD;
module.exports.MICRO_JITTER_THRESHOLD = MICRO_JITTER_THRESHOLD;
module.exports.HUMAN_MAX_VELOCITY_PX_S = HUMAN_MAX_VELOCITY_PX_S;
