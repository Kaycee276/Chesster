import { evaluationToWhitePercent, formatEvaluation } from "../utils/engineEvaluation";

interface EvaluationBarProps {
	/** Centipawn score from White's perspective (positive = White is better). */
	scoreCp: number;
	/** Signed moves to mate from White's perspective, 0 if already mated, else null. */
	mate?: number | null;
	/** Board orientation: the side shown at the bottom of the board. */
	orientation: "white" | "black";
	/** Search depth of the displayed evaluation. */
	depth?: number;
	/** True until the first evaluation arrives. */
	loading?: boolean;
}

/**
 * Vertical engine evaluation bar. White's share grows from White's side of the
 * board (bottom when viewing as White, top when viewing as Black) and animates
 * smoothly between evaluations. The numeric label sits at the end of the side
 * that is ahead.
 */
export default function EvaluationBar({
	scoreCp,
	mate = null,
	orientation,
	depth,
	loading = false,
}: EvaluationBarProps) {
	const whitePercent = loading ? 50 : evaluationToWhitePercent(scoreCp, mate);
	const label = loading ? "…" : formatEvaluation(scoreCp, mate);
	const whiteAhead = mate !== null ? scoreCp > 0 : scoreCp >= 0;
	const whiteAtBottom = orientation === "white";
	const labelAtBottom = whiteAhead === whiteAtBottom;

	const leader = whiteAhead ? "White" : "Black";
	const valueText = loading
		? "Evaluating position"
		: `${label}${depth ? `, depth ${depth}` : ""} (${leader} ${mate !== null ? "winning" : "favoured"})`;

	return (
		<div
			role="meter"
			aria-label="Engine evaluation"
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={Math.round(whitePercent)}
			aria-valuetext={valueText}
			aria-busy={loading}
			title={depth ? `Stockfish depth ${depth}` : "Stockfish evaluation"}
			className="relative w-6 sm:w-7 self-stretch min-h-40 shrink-0 select-none overflow-hidden rounded-md border border-(--border) bg-gray-900"
		>
			<div
				data-testid="evaluation-bar-white"
				className={`absolute inset-x-0 ${whiteAtBottom ? "bottom-0" : "top-0"} bg-gray-100 transition-[height] duration-500 ease-out`}
				style={{ height: `${whitePercent}%` }}
			/>
			{/* Equal-position marker */}
			<div className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-gray-500/60" />
			<span
				className={`pointer-events-none absolute inset-x-0 text-center font-mono text-[8px] sm:text-[10px] font-bold leading-none ${
					labelAtBottom ? "bottom-1" : "top-1"
				} ${whiteAhead ? "text-gray-900" : "text-gray-100"}`}
			>
				{label}
			</span>
		</div>
	);
}
