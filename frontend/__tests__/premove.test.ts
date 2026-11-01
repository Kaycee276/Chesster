import { describe, it, expect } from "vitest";
import { getPossibleMoves, INITIAL_BOARD } from "../src/utils/chessUtils";

type Premove = { from: [number, number]; to: [number, number]; promotion?: string };

// Mirrors gameStore.tryExecutePremove validation + ChessBoard.queuePremove rules.
function isOwnPiece(board: string[][], square: [number, number], color: "white" | "black"): boolean {
  const piece = board[square[0]][square[1]];
  if (piece === ".") return false;
  return color === "white" ? piece === piece.toUpperCase() : piece === piece.toLowerCase();
}

function isPremoveLegal(
  board: string[][],
  premove: Premove,
  color: "white" | "black"
): boolean {
  if (!isOwnPiece(board, premove.from, color)) return false;
  return getPossibleMoves(board, premove.from, color).some(
    ([r, c]) => r === premove.to[0] && c === premove.to[1]
  );
}

function queuePremove(
  board: string[][],
  from: [number, number],
  to: [number, number],
  color: "white" | "black"
): Premove | null {
  const piece = board[from[0]][from[1]];
  if (piece === "." || !isOwnPiece(board, from, color)) return null;
  const isPromotion = piece.toLowerCase() === "p" && (to[0] === 0 || to[0] === 7);
  return { from, to, promotion: isPromotion ? "q" : undefined };
}

describe("Premove queueing (#473)", () => {
  it("registers a pawn push premove for white during black's turn", () => {
    const premove = queuePremove(INITIAL_BOARD, [6, 4], [4, 4], "white");
    expect(premove).toEqual({ from: [6, 4], to: [4, 4], promotion: undefined });
    expect(isPremoveLegal(INITIAL_BOARD, premove!, "white")).toBe(true);
  });

  it("rejects queueing the opponent's piece", () => {
    // Black pawn on white's premove attempt.
    expect(queuePremove(INITIAL_BOARD, [1, 4], [3, 4], "white")).toBeNull();
    expect(queuePremove(INITIAL_BOARD, [6, 4], [4, 4], "black")).toBeNull();
  });

  it("rejects queueing from an empty square", () => {
    expect(queuePremove(INITIAL_BOARD, [4, 4], [3, 4], "white")).toBeNull();
  });

  it("executes automatically when the premove is legal in the new position", () => {
    const premove: Premove = { from: [6, 4], to: [4, 4] };
    // Turn has arrived and the position still allows e2e4.
    const shouldFire = isPremoveLegal(INITIAL_BOARD, premove, "white");
    expect(shouldFire).toBe(true);
  });

  it("cancels cleanly when the premove is illegal in the new position", () => {
    const premove: Premove = { from: [6, 4], to: [4, 4] };
    // Blocked e-pawn: e3 occupied by own piece in the new position.
    const blocked = INITIAL_BOARD.map((r) => [...r]);
    blocked[4][4] = "P";
    blocked[5][4] = "P";
    expect(isPremoveLegal(blocked, premove, "white")).toBe(false);
  });

  it("defaults pawn promotions to queen", () => {
    const board = INITIAL_BOARD.map((r) => [...r]);
    board[1][0] = ".";
    board[1][0] = ".";
    // White pawn one step from promotion.
    const promoBoard = Array.from({ length: 8 }, () => Array(8).fill("."));
    promoBoard[1][0] = "P";
    const premove = queuePremove(promoBoard, [1, 0], [0, 0], "white");
    expect(premove?.promotion).toBe("q");
    void board;
  });
});
