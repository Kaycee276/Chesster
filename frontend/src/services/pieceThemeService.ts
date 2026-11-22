import { PIECE_SETS, type PieceSet, type PieceSetKey } from "../store/themeStore";

/**
 * Piece codes shown in a theme preview: a 2x2 mini board of
 * King, Queen, Knight and Pawn (white pieces, row by row).
 */
export const PREVIEW_PIECE_CODES = [
	["K", "Q"],
	["N", "P"],
] as const;

const DEFAULT_PIECE_SET_KEY: PieceSetKey = "standard";

const previewCache = new Map<PieceSetKey, string[][]>();

/**
 * Resolves a piece set by key. Unknown or stale keys (for example a value
 * persisted by an older build) fall back to the standard set instead of throwing.
 */
export function getPieceSet(key: string): PieceSet {
	const match = PIECE_SETS.find((set) => set.key === key);
	if (match) return match;
	return PIECE_SETS.find((set) => set.key === DEFAULT_PIECE_SET_KEY) ?? PIECE_SETS[0];
}

/** Returns the glyph for a piece code in a set, or an empty string if the code is unknown. */
export function getPieceGlyph(key: string, code: string): string {
	return getPieceSet(key).pieces[code] ?? "";
}

/**
 * Returns the 2x2 preview glyphs for a piece set. Results are memoized per set,
 * so repeatedly rendering the theme picker does not rebuild the grid.
 */
export function getPreviewBoard(key: string): string[][] {
	const set = getPieceSet(key);
	const cached = previewCache.get(set.key);
	if (cached) return cached;

	const board = PREVIEW_PIECE_CODES.map((row) => row.map((code) => set.pieces[code] ?? ""));
	previewCache.set(set.key, board);
	return board;
}
