import { describe, expect, it } from "vitest";
import { getNextBoardSquare, getSquareAriaLabel, narrateBoardMove, clockAnnouncement } from "../boardA11y";

describe("accessible board labels", () => {
  it("identifies selection separately from legal destinations", () => {
    expect(getSquareAriaLabel("f3", "N", true, false)).toBe("white knight on f3, selected");
    expect(getSquareAriaLabel("e4", ".", false, true)).toBe("e4, empty, legal destination");
    expect(getSquareAriaLabel("d5", "p", false, true)).toBe("black pawn on d5, legal capture");
  });
});

describe("display-oriented grid navigation", () => {
  it.each([
    [[6, 4], "ArrowUp", false, [5, 4]],
    [[6, 4], "ArrowDown", false, [7, 4]],
    [[6, 4], "ArrowLeft", false, [6, 3]],
    [[6, 4], "ArrowRight", false, [6, 5]],
    [[1, 3], "ArrowUp", true, [2, 3]],
    [[1, 3], "ArrowDown", true, [0, 3]],
    [[1, 3], "ArrowLeft", true, [1, 4]],
    [[1, 3], "ArrowRight", true, [1, 2]],
    [[0, 0], "ArrowUp", false, [0, 0]],
    [[7, 7], "ArrowUp", true, [7, 7]],
  ] as const)("moves %s with %s (rotated %s)", (square, key, rotated, expected) => {
    expect(getNextBoardSquare([...square], key, rotated)).toEqual(expected);
  });

  it("leaves unowned keys alone", () => {
    expect(getNextBoardSquare([4, 4], "Tab", false)).toEqual([4, 4]);
  });
});

describe("move narration", () => {
  it("announces coordinates, captures and checks", () => {
    expect(narrateBoardMove({ piece: "N", from: [5, 5], to: [3, 4] },
      { capturedPiece: "p", inCheck: true })).toBe("white knight from f3 to e5 captures black pawn. Check.");
  });

  it("describes castling, en passant and promotion without relying on symbols", () => {
    expect(narrateBoardMove({ piece: "K", from: [7, 4], to: [7, 6] })).toContain("castles kingside");
    expect(narrateBoardMove({ piece: "P", from: [3, 4], to: [2, 3] },
      { capturedPiece: "p" })).toContain("captures black pawn");
    expect(narrateBoardMove({ piece: "P", from: [1, 0], to: [0, 0] },
      { promotion: "q", checkmate: true })).toBe("white pawn from a7 to a8 promotes to queen. Checkmate.");
  });
});

describe("clock announcements", () => {
  it("announces threshold crossings, including delayed clock updates", () => {
    expect(clockAnnouncement(31, 30, "white")).toBe("White has 30 seconds remaining.");
    expect(clockAnnouncement(11, 9, "black")).toBe("Black has 9 seconds remaining.");
    expect(clockAnnouncement(6, 5, "white")).toBe("White has 5 seconds remaining.");
  });

  it("does not interrupt on every tick, duplicate polls, or a reset", () => {
    expect(clockAnnouncement(10, 9, "white")).toBe("");
    expect(clockAnnouncement(10, 10, "white")).toBe("");
    expect(clockAnnouncement(1, 600, "white")).toBe("");
  });
});
