const chessEngine = require("../services/chessEngine");

describe("Chess Engine - Draw Detection", () => {
  describe("getPositionKey", () => {
    test("should return the same key for identical positions", () => {
      const board = chessEngine.initBoard();
      const keyA = chessEngine.getPositionKey(board, "white");
      const keyB = chessEngine.getPositionKey(board, "white");
      expect(keyA).toBe(keyB);
    });

    test("should return different keys for different turns", () => {
      const board = chessEngine.initBoard();
      const whiteKey = chessEngine.getPositionKey(board, "white");
      const blackKey = chessEngine.getPositionKey(board, "black");
      expect(whiteKey).not.toBe(blackKey);
    });

    test("should return different keys for different piece placement", () => {
      const board = chessEngine.initBoard();
      const movedBoard = chessEngine.makeMove(board, [6, 4], [4, 4]);
      const keyBefore = chessEngine.getPositionKey(board, "white");
      const keyAfter = chessEngine.getPositionKey(movedBoard, "white");
      expect(keyBefore).not.toBe(keyAfter);
    });

    test("should only include placement, turn, castling and en passant fields", () => {
      const board = chessEngine.initBoard();
      const key = chessEngine.getPositionKey(board, "white");
      expect(key.split(" ").length).toBe(4);
    });
  });

  describe("checkDrawConditions", () => {
    const key = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - -";

    test("should report no draw when repetitions and clock are low", () => {
      const result = chessEngine.checkDrawConditions(key, [key], 0);
      expect(result.isDraw).toBe(false);
      expect(result.canClaimDraw).toBe(false);
      expect(result.reason).toBeNull();
    });

    test("should allow claiming a draw at threefold repetition", () => {
      const history = [key, "other-1", key, "other-2", key];
      const result = chessEngine.checkDrawConditions(key, history, 0);
      expect(result.isDraw).toBe(false);
      expect(result.canClaimDraw).toBe(true);
      expect(result.reason).toBe("threefold_repetition");
    });

    test("should force an automatic draw at fivefold repetition", () => {
      const history = Array(5).fill(key);
      const result = chessEngine.checkDrawConditions(key, history, 0);
      expect(result.isDraw).toBe(true);
      expect(result.canClaimDraw).toBe(false);
      expect(result.reason).toBe("fivefold_repetition");
    });

    test("should allow claiming a draw at the 50-move threshold", () => {
      const result = chessEngine.checkDrawConditions(key, [key], 100);
      expect(result.isDraw).toBe(false);
      expect(result.canClaimDraw).toBe(true);
      expect(result.reason).toBe("50_move_rule");
    });

    test("should force an automatic draw at the 75-move threshold", () => {
      const result = chessEngine.checkDrawConditions(key, [key], 150);
      expect(result.isDraw).toBe(true);
      expect(result.canClaimDraw).toBe(false);
      expect(result.reason).toBe("75_move_rule");
    });

    test("should prioritize fivefold repetition over the 75-move rule when both apply", () => {
      const history = Array(5).fill(key);
      const result = chessEngine.checkDrawConditions(key, history, 150);
      expect(result.reason).toBe("fivefold_repetition");
    });
  });
});
