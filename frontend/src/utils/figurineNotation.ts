/**
 * Figurine Algebraic Notation (FAN) helpers (Issue #661).
 *
 * Standard algebraic notation names pieces with English letters (`Nf3`, `Qxd4+`).
 * Figurine notation replaces the leading piece letter with the Unicode chess glyph
 * for that piece and colour (`♘f3`, `♕xd4+`), which reads the same in every language.
 * Pawn moves (`e4`, `exd5`) and castling (`O-O`) have no piece letter, so they are unchanged.
 */

export type FigurineColor = "w" | "b";

/** Piece letter to Unicode glyph, per colour. Only upper-case piece letters are mapped. */
export const FIGURINES: Readonly<Record<FigurineColor, Readonly<Record<string, string>>>> = {
  w: { K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘" },
  b: { K: "♚", Q: "♛", R: "♜", B: "♝", N: "♞" },
};

/**
 * Replaces the leading piece letter of a SAN move with its figurine glyph.
 *
 * @param san - Move in standard algebraic notation, e.g. `Nf3` or `e4`.
 * @param color - Colour of the side that played the move: `w` or `b`.
 * @returns The move with its piece letter replaced, or `san` unchanged when it has no piece letter.
 */
export function toFigurineNotation(san: string, color: FigurineColor): string {
  const glyph = FIGURINES[color][san.charAt(0)];
  return glyph ? glyph + san.slice(1) : san;
}

/**
 * Formats a move for display, using figurines only when `useFigurine` is set.
 *
 * @param san - Move in standard algebraic notation.
 * @param color - Colour of the side that played the move: `w` or `b`.
 * @param useFigurine - Whether to show figurine glyphs instead of piece letters.
 */
export function formatMove(san: string, color: FigurineColor, useFigurine: boolean): string {
  return useFigurine ? toFigurineNotation(san, color) : san;
}
