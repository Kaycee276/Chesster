import { describe, expect, it } from "vitest";

import { INITIAL_BOARD, applyMove, getPossibleMoves } from "../utils/chessUtils";
import { loadPgn, parsePgn } from "../utils/pgnParser";

describe("Chess engine and PGN boundary cases", () => {
  it("preserves comments, NAGs, headers, and results while parsing PGN", () => {
    const parsed = parsePgn('[Event "Test"]\n\n1. e4 $1 e5 {reply} 2. Nf3 (2. d4) Nc6 1-0');
    expect(parsed.headers.Event).toBe("Test");
    expect(parsed.sanMoves).toEqual(["e4", "e5", "Nf3", "Nc6"]);
    expect(parsed.result).toBe("1-0");
  });

  it.each([
    ["white pawn", [6, 4], [[5, 4], [4, 4]], "white"],
    ["black pawn", [1, 4], [[2, 4], [3, 4]], "black"],
    ["white knight", [7, 1], [[5, 0], [5, 2]], "white"],
    ["black knight", [0, 1], [[2, 0], [2, 2]], "black"],
  ])("calculates legal opening moves for %s", (_name, from, expected, turn) => {
    expect(getPossibleMoves(INITIAL_BOARD, from as [number, number], turn as "white" | "black")).toEqual(expect.arrayContaining(expected));
  });

  it("replays a legal opening without mutating the initial board", () => {
    const initial = INITIAL_BOARD.map((row) => [...row]);
    const replayed = loadPgn('[Event "Opening"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *');
    expect(replayed.moves).toHaveLength(6);
    expect(INITIAL_BOARD).toEqual(initial);
  });

  it("supports promotion and capture board transitions", () => {
    const board = INITIAL_BOARD.map((row) => [...row]);
    board[1][0] = ".";
    board[6][0] = ".";
    board[1][1] = "P";
    const result = applyMove(board, [1, 1], [0, 0], "n");
    expect(result.board[0][0]).toBe("N");
    expect(result.isCapture).toBe(true);
  });
});
