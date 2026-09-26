import { useEffect } from "react";
import { ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight, Play, Pause } from "lucide-react";

interface MoveNavigatorProps {
	/** -1 = starting position, otherwise the index of the last played move. */
	currentMoveIndex: number;
	totalMoves: number;
	isPlaying: boolean;
	onMoveChange: (index: number) => void;
	onTogglePlay: () => void;
}

/**
 * Playback controls for the analysis board (#251): first/previous/
 * play-pause/next/last buttons plus a scrub slider, driven purely by
 * `currentMoveIndex` so the caller stays the single source of truth for
 * board position.
 */
export default function MoveNavigator({
	currentMoveIndex,
	totalMoves,
	isPlaying,
	onMoveChange,
	onTogglePlay,
}: MoveNavigatorProps) {
	const atStart = currentMoveIndex <= -1;
	const atEnd = currentMoveIndex >= totalMoves - 1;

	// Auto-advance one ply at a time while playing; pausing again once the
	// mainline runs out, via the same callback the pause button uses.
	useEffect(() => {
		if (!isPlaying || totalMoves === 0) return;
		if (currentMoveIndex >= totalMoves - 1) {
			onTogglePlay();
			return;
		}
		const t = setTimeout(() => {
			onMoveChange(Math.min(totalMoves - 1, currentMoveIndex + 1));
		}, 800);
		return () => clearTimeout(t);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [isPlaying, currentMoveIndex, totalMoves]);

	return (
		<div className="flex flex-col gap-2 w-full">
			<div className="flex items-center justify-center gap-2 py-2">
				<button
					onClick={() => onMoveChange(-1)}
					disabled={atStart}
					title="First move"
					className="p-2 rounded-lg bg-(--bg-secondary) border border-(--border) hover:border-(--accent-primary)/60 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
				>
					<ChevronsLeft size={16} />
				</button>
				<button
					onClick={() => onMoveChange(currentMoveIndex - 1)}
					disabled={atStart}
					title="Previous move"
					className="p-2 rounded-lg bg-(--bg-secondary) border border-(--border) hover:border-(--accent-primary)/60 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
				>
					<ChevronLeft size={16} />
				</button>
				<button
					onClick={onTogglePlay}
					disabled={totalMoves === 0}
					title={isPlaying ? "Pause" : "Play"}
					className="p-2.5 rounded-lg bg-(--accent-dark) hover:bg-(--accent-primary) disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-white"
				>
					{isPlaying ? <Pause size={16} /> : <Play size={16} />}
				</button>
				<button
					onClick={() => onMoveChange(currentMoveIndex + 1)}
					disabled={atEnd}
					title="Next move"
					className="p-2 rounded-lg bg-(--bg-secondary) border border-(--border) hover:border-(--accent-primary)/60 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
				>
					<ChevronRight size={16} />
				</button>
				<button
					onClick={() => onMoveChange(totalMoves - 1)}
					disabled={atEnd}
					title="Last move"
					className="p-2 rounded-lg bg-(--bg-secondary) border border-(--border) hover:border-(--accent-primary)/60 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
				>
					<ChevronsRight size={16} />
				</button>
			</div>

			{totalMoves > 0 && (
				<div className="flex items-center gap-2 px-1">
					<span className="text-[10px] font-mono text-(--text-tertiary) w-6 text-right">
						{currentMoveIndex + 1}
					</span>
					<input
						type="range"
						min={-1}
						max={totalMoves - 1}
						value={currentMoveIndex}
						onChange={(e) => onMoveChange(Number(e.target.value))}
						className="flex-1 accent-(--accent-primary)"
						aria-label="Move scrubber"
					/>
					<span className="text-[10px] font-mono text-(--text-tertiary) w-6">
						{totalMoves}
					</span>
				</div>
			)}
		</div>
	);
}
