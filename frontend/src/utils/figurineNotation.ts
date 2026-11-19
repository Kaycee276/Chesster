/**
 * figurineNotation.ts
 *
 * Provides utilities to transform Standard Algebraic Notation (SAN)
 * chess moves into Figurine Algebraic Notation (FAN) using Unicode piece glyphs.
 */

export const FIGURINES = {
  w: { K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘" },
  b: { K: "♚", Q: "♛", R: "♜", B: "♝", N: "♞" },
} as const;

export function toFigurineNotation(sanMove: string, pieceColor: "w" | "b"): string {
  if (!sanMove) return sanMove;
  const firstChar = sanMove[0] as keyof (typeof FIGURINES)["w"];
  if (FIGURINES[pieceColor] && FIGURINES[pieceColor][firstChar]) {
    return FIGURINES[pieceColor][firstChar] + sanMove.slice(1);
  }
  return sanMove;
}

export function formatMove(san: string, color: "w" | "b", useFigurine: boolean): string {
  if (!useFigurine) return san;
  return toFigurineNotation(san, color);
}
