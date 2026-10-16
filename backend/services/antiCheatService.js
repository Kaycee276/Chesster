const supabase = require("../config/supabase");
const botService = require("./botService");
const gameModel = require("../models/gameModel");
const { boardToFEN } = require("./botService");

const FLAG_THRESHOLD = 0.85;
const MIN_TIMED_MOVES = 5;
const ACPL_WINDOW_SIZE = 10;
const ENGINE_STREAK_MAX_ACPL = 5;
const ENGINE_STREAK_MIN_CORRELATION = 0.9;

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
	constructor({ db = supabase, engine = botService, games = gameModel, logger = console } = {}) {
		this.db = db;
		this.engine = engine;
		this.games = games;
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

	buildPlayerAnalysis(color, playerAddress, telemetry, engineResults, rating = null) {
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
			suspicionScore,
			score,
			flagged: score > FLAG_THRESHOLD || Boolean(suspiciousEngineWindow),
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
			);
		}

		await this.games.recordCheatAnalysis(gameId, analysis);
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
