// Accessibility helpers for the chess board (#134).
//
// Board coordinates are 0-indexed with row 0 at the top (rank 8) and column 0
// on the left (file a), matching the engine's board representation. Pieces use
// FEN letters: uppercase = white, lowercase = black.

/** Spoken names for each piece letter. */
export const PIECE_NAMES: Record<string, string> = {
	k: "king",
	q: "queen",
	r: "rook",
	b: "bishop",
	n: "knight",
	p: "pawn",
};

/** Algebraic name of a square, e.g. (0, 0) -> "a8", (7, 7) -> "h1". */
export function squareName(row: number, col: number): string {
	const file = "abcdefgh"[col] ?? "?";
	const rank = 8 - row;
	return `${file}${rank}`;
}

/**
 * Screen-reader label for a square, e.g. "white knight on f3" or "f3, empty".
 * A piece value of "." or an empty string is treated as an empty square.
 */
export function squareAriaLabel(piece: string, row: number, col: number): string {
	const square = squareName(row, col);
	if (!piece || piece === ".") return `${square}, empty`;
	const color = piece === piece.toUpperCase() ? "white" : "black";
	const name = PIECE_NAMES[piece.toLowerCase()] ?? "piece";
	return `${color} ${name} on ${square}`;
}
