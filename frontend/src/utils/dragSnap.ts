import type { BoardSquare } from "../types/chess";

/** Glowing outline applied to the hovered legal destination while dragging (#584). */
export const DRAG_SNAP_CLASSES = "drag-snap-target ring-2 ring-emerald-400/60 ring-inset bg-emerald-500/10";

/** Elevation scale of the drag ghost. */
export const GHOST_SCALE = 1.15;

export function isSameSquare(a: BoardSquare | null, b: BoardSquare | null): boolean {
	if (a === null || b === null) return a === b;
	return a[0] === b[0] && a[1] === b[1];
}

/**
 * Whether dropping the dragged piece on `target` is a legal move. The origin
 * square never counts as a destination.
 */
export function isLegalDragTarget(
	source: BoardSquare,
	target: BoardSquare,
	legalMoves: readonly BoardSquare[],
): boolean {
	if (isSameSquare(source, target)) return false;
	return legalMoves.some((move) => isSameSquare(move, target));
}
