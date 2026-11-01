import { describe, it, expect } from "vitest";
import {
  isMaterialSacrifice,
  computeMaterial,
  SACRIFICE_PIECE_VALUES,
} from "../../src/hooks/useMoveAccuracyAnalysis";
import { INITIAL_BOARD } from "../../src/utils/chessUtils";
import type { ReplayedMove } from "../../src/utils/pgnParser";

describe("useMoveAccuracyAnalysis - Material Sacrifice & Brilliant Move Detection", () => {
  it("correctly computes material counts using piece values (P=1, N=3, B=3, R=5, Q=9)", () => {
    expect(SACRIFICE_PIECE_VALUES["P"]).toBe(1);
    expect(SACRIFICE_PIECE_VALUES["N"]).toBe(3);
    expect(SACRIFICE_PIECE_VALUES["B"]).toBe(3);
    expect(SACRIFICE_PIECE_VALUES["R"]).toBe(5);
    expect(SACRIFICE_PIECE_VALUES["Q"]).toBe(9);

    // Initial board material: 8 pawns(8) + 2 knights(6) + 2 bishops(6) + 2 rooks(10) + 1 queen(9) = 39
    expect(computeMaterial(INITIAL_BOARD, "white")).toBe(39);
    expect(computeMaterial(INITIAL_BOARD, "black")).toBe(39);
  });

  it("detects Greek Gift sacrifice (Bxh7+ followed by Kxh7)", () => {
    // Set up a classical Greek gift board before sacrifice:
    // White bishop on d3, Black pawn on h7, Black king on g8
    const boardBefore: string[][] = Array.from({ length: 8 }, () => Array(8).fill("."));
    boardBefore[0][4] = "k"; // Black king on e8 / g8
    boardBefore[1][7] = "p"; // Black pawn on h7
    boardBefore[5][3] = "B"; // White bishop on d3
    boardBefore[7][4] = "K"; // White king on e1

    // Move 1: Bxh7+ (White trades Bishop (3) for Pawn (1))
    const boardAfterBxh7: string[][] = boardBefore.map((row) => [...row]);
    boardAfterBxh7[5][3] = ".";
    boardAfterBxh7[1][7] = "B"; // Bishop on h7, pawn captured

    const whiteSacrificeMove: ReplayedMove = {
      moveNumber: 1,
      color: "white",
      san: "Bxh7+",
      from: [5, 3],
      to: [1, 7],
      piece: "B",
      isCapture: true,
      isCheck: true,
      isCheckmate: false,
      boardAfter: boardAfterBxh7,
    };

    // Move 2: Kxh7 (Black captures the sacrificed bishop)
    const boardAfterKxh7: string[][] = boardAfterBxh7.map((row) => [...row]);
    boardAfterKxh7[0][4] = ".";
    boardAfterKxh7[1][7] = "k";

    const blackCaptureMove: ReplayedMove = {
      moveNumber: 1,
      color: "black",
      san: "Kxh7",
      from: [0, 4],
      to: [1, 7],
      piece: "k",
      isCapture: true,
      isCheck: false,
      isCheckmate: false,
      boardAfter: boardAfterKxh7,
    };

    // White net diff: White gave up Bishop (3) for Pawn (1) -> net diff = (0 - 0) - (0 - (-1)) = -2 net material
    // Or opponent nextMove captures the bishop:
    const isSac = isMaterialSacrifice(whiteSacrificeMove, boardBefore, blackCaptureMove);
    expect(isSac).toBe(true);
  });

  it("does not classify equal exchanges as material sacrifice", () => {
    // Queen takes Queen exchange
    const boardBefore: string[][] = Array.from({ length: 8 }, () => Array(8).fill("."));
    boardBefore[0][3] = "q";
    boardBefore[7][3] = "Q";

    const boardAfterQxq: string[][] = boardBefore.map((row) => [...row]);
    boardAfterQxq[7][3] = ".";
    boardAfterQxq[0][3] = "Q";

    const queenTakesQueen: ReplayedMove = {
      moveNumber: 1,
      color: "white",
      san: "Qxd8+",
      from: [7, 3],
      to: [0, 3],
      piece: "Q",
      isCapture: true,
      isCheck: false,
      isCheckmate: false,
      boardAfter: boardAfterQxq,
    };

    // Before: White has Q (9), Black has Q (9).
    // After: White has Q (9), Black has 0.
    // White gained net material (+9 - 0 = +9) on the capture ply, not sacrificed.
    const isSac = isMaterialSacrifice(queenTakesQueen, boardBefore);
    expect(isSac).toBe(false);
  });

  it("detects sacrifice when piece is placed en prise without capture", () => {
    // E.g., White plays Rh8+ sacrificing rook for tactical deflection
    const boardBefore: string[][] = Array.from({ length: 8 }, () => Array(8).fill("."));
    boardBefore[0][4] = "k"; // Black king
    boardBefore[7][0] = "R"; // White rook

    const boardAfterRh8: string[][] = boardBefore.map((row) => [...row]);
    boardAfterRh8[7][0] = ".";
    boardAfterRh8[0][7] = "R"; // Rook on h8 en prise

    const rookSacrifice: ReplayedMove = {
      moveNumber: 1,
      color: "white",
      san: "Rh8+",
      from: [7, 0],
      to: [0, 7],
      piece: "R",
      isCapture: false,
      isCheck: true,
      isCheckmate: false,
      boardAfter: boardAfterRh8,
    };

    // Black captures rook on next ply: Kxh8
    const boardAfterKxh8: string[][] = boardAfterRh8.map((row) => [...row]);
    boardAfterKxh8[0][4] = ".";
    boardAfterKxh8[0][7] = "k";

    const kingCapturesRook: ReplayedMove = {
      moveNumber: 1,
      color: "black",
      san: "Kxh8",
      from: [0, 4],
      to: [0, 7],
      piece: "k",
      isCapture: true,
      isCheck: false,
      isCheckmate: false,
      boardAfter: boardAfterKxh8,
    };

    const isSac = isMaterialSacrifice(rookSacrifice, boardBefore, kingCapturesRook);
    expect(isSac).toBe(true);
  });
});
