/**
 * chess.ts
 *
 * Shared types for the board's analysis annotation overlay (right-click
 * arrows and square highlights). Squares are represented as [row, col]
 * tuples, matching the rest of the codebase (see MoveRecord in game.ts)
 * rather than algebraic notation.
 */

export type AnnotationColor = "green" | "red" | "yellow" | "blue";

export interface SquareHighlight {
	row: number;
	col: number;
	color: AnnotationColor;
}

export interface AnnotationArrow {
	from: [number, number];
	to: [number, number];
	color: AnnotationColor;
}

/** A board square as a [row, col] tuple. */
export type BoardSquare = [number, number];

/** Viewport coordinates of the drag ghost (#584). */
export interface DragPosition {
	x: number;
	y: number;
}

/** A piece pickup that has not yet moved far enough to count as a drag. */
export interface PendingDrag {
	row: number;
	col: number;
	piece: string;
	pointerId: number;
	pointerType: string;
	startX: number;
	startY: number;
}

/** An active piece drag: the source square, the piece and the ghost position. */
export interface DragState extends DragPosition {
	row: number;
	col: number;
	piece: string;
	pointerId: number;
	pointerType: string;
}
