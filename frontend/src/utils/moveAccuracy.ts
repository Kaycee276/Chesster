import { MATE_SCORE_CP } from "./engineEvaluation";

/**
 * Move accuracy & blunder classification (#313).
 *
 * Every played move is scored by how many centipawns of evaluation it cost
 * the player who made it (centipawn loss, CPL). Losses map onto the standard
 * chess.com-style glyph scale, and each side gets an overall accuracy
 * percentage derived from the mean loss across their moves:
 *
 *   accuracy = 100 * exp(-0.004 * mean_cpl)
 *
 * The formulas here are pure so they can be unit-tested against known
 * evaluation sequences and reused by any engine-backed analysis view.
 */

/** Move quality categories, worst last. */
export type MoveQuality = "best" | "good" | "inaccuracy" | "mistake" | "blunder";

/** Classification thresholds, in centipawns of loss (≤ threshold). */
export const CPL_THRESHOLDS: Record<Exclude<MoveQuality, "blunder">, number> = {
	best: 15,
	good: 60,
	inaccuracy: 150,
	mistake: 300,
};

/**
 * Classifies a move from the centipawn loss it caused:
 *   best (≤15) → good (≤60) → inaccuracy (≤150) → mistake (≤300) → blunder.
 * Negative deltas (the position improved for the mover) count as best.
 */
export function classifyMove(cplDelta: number): MoveQuality {
	if (cplDelta <= CPL_THRESHOLDS.best) return "best";
	if (cplDelta <= CPL_THRESHOLDS.good) return "good";
	if (cplDelta <= CPL_THRESHOLDS.inaccuracy) return "inaccuracy";
	if (cplDelta <= CPL_THRESHOLDS.mistake) return "mistake";
	return "blunder";
}

/**
 * Accuracy percentage from a mean centipawn loss:
 *   100 * exp(-0.004 * mean_cpl)
 * Perfect play (0 mean loss) yields 100%; losses decay exponentially.
 */
export function moveAccuracyPercent(meanCpl: number): number {
	const clamped = Math.max(0, meanCpl);
	return 100 * Math.exp(-0.004 * clamped);
}

/** Arithmetic mean, or 0 for an empty set (an unplayed side is 100%). */
export function meanCpl(cplValues: number[]): number {
	if (cplValues.length === 0) return 0;
	return cplValues.reduce((sum, v) => sum + v, 0) / cplValues.length;
}

/** Evaluated positions before/after a played move (White's perspective). */
export interface EvalPair {
	/** White-perspective centipawn score before the move (null if unavailable). */
	before: number | null;
	/** White-perspective centipawn score after the move (null if unavailable). */
	after: number | null;
}

/** Classification result for a single played move. */
export interface MoveClassification {
	/** Centipawn loss suffered by the mover (≥ 0). */
	cpl: number;
	quality: MoveQuality;
}

/** Centipawn loss a move cost the player who made it, clamped to [0, MATE].
 * Evaluations are White-perspective, so the mover's color decides the sign:
 * White loses when the eval drops, Black when it rises. */
export function centipawnLoss(
	{ before, after }: EvalPair,
	mover: "white" | "black",
): number {
	if (before === null || after === null) return 0;
	const whiteDelta = after - before;
	const raw = mover === "white" ? -whiteDelta : whiteDelta;
	return Math.min(Math.max(raw, 0), MATE_SCORE_CP);
}

/** Aggregated accuracy statistics for one side. */
export interface AccuracySummary {
	/** Overall accuracy percentage for this side (100 for no moves). */
	accuracy: number;
	/** Mean centipawn loss across this side's moves. */
	meanCpl: number;
	/** Total moves evaluated for this side. */
	total: number;
	/** Move count per quality category. */
	counts: Record<MoveQuality, number>;
}

function emptyCounts(): Record<MoveQuality, number> {
	return { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
}

/**
 * Classifies every move in a game and aggregates accuracy per side.
 *
 * `evals[i]` is the White-perspective evaluation of the position *before*
 * move i is played and `evals[i + 1]` the position after; a null entry marks
 * a position the engine could not evaluate. Moves are alternating white/black
 * starting with White (plies), matching the move list layout.
 */
export function analyzeAccuracy(
	evals: (number | null)[],
): { moves: MoveClassification[]; white: AccuracySummary; black: AccuracySummary } {
	const moves: MoveClassification[] = [];
	const whiteLosses: number[] = [];
	const blackLosses: number[] = [];

	for (let i = 0; i < evals.length - 1; i++) {
		const mover: "white" | "black" = i % 2 === 0 ? "white" : "black";
		const before = evals[i];
		const after = evals[i + 1];
		const cpl = centipawnLoss({ before, after }, mover);
		moves.push({ cpl, quality: classifyMove(cpl) });
		// Moves with a missing evaluation have an unknowable loss; counting
		// them as zero-loss would inflate accuracy, so they are excluded.
		if (before !== null && after !== null) {
			(mover === "white" ? whiteLosses : blackLosses).push(cpl);
		}
	}

	const summarize = (losses: number[]): AccuracySummary => {
		const counts = emptyCounts();
		for (const loss of losses) counts[classifyMove(loss)]++;
		const mean = meanCpl(losses);
		return {
			accuracy: moveAccuracyPercent(mean),
			meanCpl: mean,
			total: losses.length,
			counts,
		};
	};

	return { moves, white: summarize(whiteLosses), black: summarize(blackLosses) };
}

/** Display metadata for a move quality category. */
export const MOVE_QUALITY_META: Record<
	MoveQuality,
	{ glyph: string; label: string; className: string }
> = {
	best: { glyph: "!", label: "Best", className: "acc-best" },
	good: { glyph: "✓", label: "Good", className: "acc-good" },
	inaccuracy: { glyph: "?!", label: "Inaccuracy", className: "acc-inaccuracy" },
	mistake: { glyph: "?", label: "Mistake", className: "acc-mistake" },
	blunder: { glyph: "??", label: "Blunder", className: "acc-blunder" },
};

/** Formats an accuracy percentage for display, e.g. "88.4". */
export function formatAccuracy(accuracy: number): string {
	return accuracy.toFixed(1);
}
