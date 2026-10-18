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
		};
	}

	buildPlayerAnalysis(color, playerAddress, telemetry, engineResults, rating = null, timing = null) {
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
		for (const color of ["white", "black"]) {
			const entries = grouped[color];
			const engineResults = [];
			for (const entry of entries) {
				try {
					engineResults.push(await this.analyzeEngineMove(entry));
				} catch (error) {
					this.logger.warn(`[AntiCheat] Engine analysis skipped: ${error.message}`);
					engineResults.push(null);
				}
			}
			analysis[color] = this.buildPlayerAnalysis(
				color,
				entries[0]?.player_address || null,
				entries,
				engineResults,
				ratings[color],
				moveTimes[color],
			);
		}

		await this.games.recordCheatAnalysis(gameId, analysis);
		return analysis;
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
module.exports.ENTROPY_BIN_EDGES_MS = ENTROPY_BIN_EDGES_MS;
module.exports.LOW_ENTROPY_THRESHOLD = LOW_ENTROPY_THRESHOLD;
module.exports.HIGH_ENTROPY_THRESHOLD = HIGH_ENTROPY_THRESHOLD;
module.exports.MIN_ENTROPY_SAMPLES = MIN_ENTROPY_SAMPLES;
module.exports.OPENING_BOOK_MOVES = OPENING_BOOK_MOVES;
