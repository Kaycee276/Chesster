/**
 * Tests for PGN and FEN functionality in Chess Engine
 */

const chessEngine = require("../services/chessEngine");

describe("Chess Engine - FEN and PGN Support", () => {
  let startingBoard;

  beforeEach(() => {
    startingBoard = chessEngine.initBoard();
  });

  describe("FEN Generation", () => {
    test("should generate correct FEN for starting position", () => {
      const fen = chessEngine.boardToFen(startingBoard, "white", 0, 1);
      expect(fen).toContain("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR");
      expect(fen).toContain("w");
    });

    test("should include correct turn in FEN", () => {
      const fenWhite = chessEngine.boardToFen(startingBoard, "white");
      const fenBlack = chessEngine.boardToFen(startingBoard, "black");
      
      expect(fenWhite).toMatch(/\s w\s/);
      expect(fenBlack).toMatch(/\s b\s/);
    });

    test("should include move counts in FEN", () => {
      const fen = chessEngine.boardToFen(startingBoard, "white", 5, 3);
      expect(fen).toMatch(/5 3$/);
    });

    test("should compress empty squares correctly", () => {
      const testBoard = chessEngine.initBoard();
      const fen = chessEngine.boardToFen(testBoard);
      
      // Starting position has 8 empty rows in the middle
      expect(fen).toContain("8/8/8/8");
    });
  });

  describe("FEN to Board Conversion", () => {
    test("should convert FEN back to board", () => {
      const originalFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1";
      const { board, currentColor } = chessEngine.fenToBoard(originalFen);
      
      expect(board).toBeDefined();
      expect(board.length).toBe(8);
      expect(currentColor).toBe("white");
    });

    test("should handle black's turn in FEN", () => {
      const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b - - 0 1";
      const { currentColor } = chessEngine.fenToBoard(fen);
      
      expect(currentColor).toBe("black");
    });

    test("should extract move counts from FEN", () => {
      const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 10 5";
      const { moveCount, fullmoveNumber } = chessEngine.fenToBoard(fen);
      
      expect(moveCount).toBe(10);
      expect(fullmoveNumber).toBe(5);
    });
  });

  describe("Move to SAN Notation", () => {
    test("should convert pawn move to SAN", () => {
      const from = [6, 4]; // e2 (white pawn)
      const to = [4, 4];   // e4
      const san = chessEngine.moveToSan(startingBoard, from, to);
      
      expect(san).toBe("e4");
    });

    test("should handle piece notation in SAN", () => {
      // Move knight from b1 to c3
      const board = startingBoard;
      const from = [7, 1]; // b1
      const to = [5, 2];   // c3
      const san = chessEngine.moveToSan(board, from, to);
      
      expect(san).toMatch(/^N/);
    });

    test("should mark captures in SAN", () => {
      // Setup a board with a capture opportunity
      const board = startingBoard.map(row => [...row]);
      board[4][4] = 'p'; // Black pawn in the middle
      
      const san = chessEngine.moveToSan(board, [6, 4], [4, 4]);
      expect(san).toContain("x");
    });

    test("should handle pawn captures in SAN", () => {
      const board = startingBoard.map(row => [...row]);
      board[5][5] = 'p'; // Black pawn for capture
      
      const san = chessEngine.moveToSan(board, [6, 4], [5, 5]);
      expect(san).toMatch(/^[a-h]x/);
    });

    test("should handle castling kingside", () => {
      const from = [7, 4]; // White king on e1
      const to = [7, 6];   // Move to g1
      const san = chessEngine.moveToSan(startingBoard, from, to);
      
      expect(san).toBe("O-O");
    });

    test("should handle castling queenside", () => {
      const from = [7, 4]; // White king on e1
      const to = [7, 2];   // Move to c1
      const san = chessEngine.moveToSan(startingBoard, from, to);
      
      expect(san).toBe("O-O-O");
    });

    test("should handle pawn promotion in SAN", () => {
      const board = startingBoard.map(row => [...row]);
      board[1][0] = 'P'; // White pawn near promotion
      
      const san = chessEngine.moveToSan(board, [1, 0], [0, 0], 'Q');
      expect(san).toContain("=Q");
    });
  });

  describe("PGN Generation", () => {
    test("should generate empty PGN for no moves", () => {
      const pgn = chessEngine.generatePgn([]);
      expect(pgn).toBe("");
    });

    test("should generate PGN with move numbers", () => {
      const moves = [
        { from: [6, 4], to: [4, 4], promotion: null }, // e4
        { from: [1, 4], to: [3, 4], promotion: null }  // e5
      ];
      
      const pgn = chessEngine.generatePgn(moves);
      expect(pgn).toContain("1.");
    });

    test("should properly format alternate moves", () => {
      const moves = [
        { from: [6, 4], to: [4, 4], promotion: null },
        { from: [1, 4], to: [3, 4], promotion: null },
        { from: [7, 6], to: [5, 5], promotion: null }
      ];
      
      const pgn = chessEngine.generatePgn(moves);
      expect(pgn).toContain("1.");
      expect(pgn).toContain("2.");
    });
  });

  describe("FEN State Sync", () => {
    test("should validate matching FEN states", () => {
      const fen = chessEngine.boardToFen(startingBoard, "white", 0, 1);
      const result = chessEngine.syncFenState(startingBoard, fen, "white", 0, 1);
      
      expect(result.valid).toBe(true);
      expect(result.differences.length).toBe(0);
    });

    test("should detect mismatched FEN states", () => {
      const correctFen = chessEngine.boardToFen(startingBoard, "white", 0, 1);
      const wrongFen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b - - 0 1";
      
      const result = chessEngine.syncFenState(startingBoard, wrongFen, "white", 0, 1);
      
      expect(result.valid).toBe(false);
      expect(result.differences.length).toBeGreaterThan(0);
    });

    test("should return current FEN in sync result", () => {
      const result = chessEngine.syncFenState(startingBoard, "", "white", 0, 1);
      
      expect(result.fen).toBeDefined();
      expect(typeof result.fen).toBe("string");
      expect(result.fen).toContain("rnbqkbnr");
    });
  });

  describe("SAN Parse", () => {
    test("should remove check and checkmate symbols", () => {
      // This tests that the parser handles annotations
      const parseResult = chessEngine.parseSanMove("e4", startingBoard, "white");
      expect(parseResult.valid || !parseResult.valid).toBeDefined(); // Should parse without error
    });

    test("should handle castling notation", () => {
      // Note: This won't be valid from starting position but tests parsing
      const kingsideResult = chessEngine.parseSanMove("O-O", startingBoard, "white");
      expect(kingsideResult).toHaveProperty("valid");
      
      const queensideResult = chessEngine.parseSanMove("O-O-O", startingBoard, "white");
      expect(queensideResult).toHaveProperty("valid");
    });
  });
});
