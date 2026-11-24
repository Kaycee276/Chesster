// Board coordinates use row 0 at rank 8 and column 0 at file a.
// Pieces use FEN letters: uppercase is white, lowercase is black.

import type { BoardSquare } from "../types/chess";

export const PIECE_NAMES: Record<string, string> = {
  k: "king", q: "queen", r: "rook", b: "bishop", n: "knight", p: "pawn",
};

export function squareName(row: number, col: number): string {
  return `${"abcdefgh"[col] ?? "?"}${8 - row}`;
}

/** Preserve the label used by existing board consumers. */
export function squareAriaLabel(piece: string, row: number, col: number): string {
  return getSquareAriaLabel(squareName(row, col), piece);
}

export function getSquareAriaLabel(
  square: string, piece: string, isSelected = false, isLegalTarget = false,
): string {
  const occupied = !!piece && piece !== ".";
  const color = piece === piece.toUpperCase() ? "white" : "black";
  const label = occupied
    ? `${color} ${PIECE_NAMES[piece.toLowerCase()] ?? "piece"} on ${square}`
    : `${square}, empty`;
  return label + (isSelected ? ", selected" : "") +
    (isLegalTarget ? occupied ? ", legal capture" : ", legal destination" : "");
}

/** Arrow directions follow the displayed board, including a manual flip. */
export function getNextBoardSquare(square: BoardSquare, key: string, rotated: boolean): BoardSquare {
  const direction = rotated ? -1 : 1;
  const rowDelta = key === "ArrowUp" ? -1 : key === "ArrowDown" ? 1 : 0;
  const colDelta = key === "ArrowLeft" ? -1 : key === "ArrowRight" ? 1 : 0;
  return [
    Math.max(0, Math.min(7, square[0] + rowDelta * direction)),
    Math.max(0, Math.min(7, square[1] + colDelta * direction)),
  ];
}

export interface BoardMove {
  piece: string;
  from: BoardSquare;
  to: BoardSquare;
}

export function narrateBoardMove(
  move: BoardMove,
  options: { capturedPiece?: string; inCheck?: boolean; checkmate?: boolean; promotion?: string } = {},
): string {
  const color = move.piece === move.piece.toUpperCase() ? "white" : "black";
  const pieceName = PIECE_NAMES[move.piece.toLowerCase()] ?? "piece";
  let description = `${color} ${pieceName} from ${squareName(...move.from)} to ${squareName(...move.to)}`;
  if (move.piece.toLowerCase() === "k" && Math.abs(move.to[1] - move.from[1]) === 2) {
    description += move.to[1] > move.from[1] ? " castles kingside" : " castles queenside";
  }
  if (options.capturedPiece && options.capturedPiece !== ".") {
    const capturedColor = options.capturedPiece === options.capturedPiece.toUpperCase() ? "white" : "black";
    description += ` captures ${capturedColor} ${PIECE_NAMES[options.capturedPiece.toLowerCase()] ?? "piece"}`;
  }
  if (options.promotion) description += ` promotes to ${PIECE_NAMES[options.promotion.toLowerCase()] ?? "piece"}`;
  return description + "." + (options.checkmate ? " Checkmate." : options.inCheck ? " Check." : "");
}

/** Announce meaningful low-clock thresholds instead of interrupting every second. */
export function clockAnnouncement(previous: number, next: number, turn: "white" | "black"): string {
  if (!Number.isFinite(previous) || !Number.isFinite(next) || next < 0 || next >= previous) return "";
  if (![30, 10, 5, 1].some(threshold => previous > threshold && next <= threshold)) return "";
  return `${turn === "white" ? "White" : "Black"} has ${next} seconds remaining.`;
}
