const chessEngine = require("../services/chessEngine");

describe("Chess Engine", () => {
  describe("initBoard", () => {
    it("should initialize a standard 8x8 chess board", () => {
      const board = chessEngine.initBoard();
      expect(board.length).toBe(8);
      expect(board[0].length).toBe(8);
      
      // Check some initial positions
      expect(board[0][0]).toBe("r"); // Black rook
      expect(board[0][4]).toBe("k"); // Black king
      expect(board[7][0]).toBe("R"); // White rook
      expect(board[7][4]).toBe("K"); // White king
      expect(board[1][0]).toBe("p"); // Black pawn
      expect(board[6][0]).toBe("P"); // White pawn
      expect(board[3][3]).toBe("."); // Empty square
    });
  });

  describe("isValidMove", () => {
    let board;

    beforeEach(() => {
      board = chessEngine.initBoard();
    });

    it("should allow a valid pawn move", () => {
      const result = chessEngine.isValidMove(board, [6, 4], [4, 4], "white", null);
      expect(result.valid).toBe(true);
    });

    it("should reject an invalid pawn move", () => {
      const result = chessEngine.isValidMove(board, [6, 4], [3, 4], "white", null);
      expect(result.valid).toBe(false);
    });

    it("should reject moving opponent's piece", () => {
      const result = chessEngine.isValidMove(board, [1, 4], [3, 4], "white", null);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("Not your piece");
    });

    it("should allow a valid knight move", () => {
      const result = chessEngine.isValidMove(board, [7, 1], [5, 2], "white", null);
      expect(result.valid).toBe(true);
    });

    it("should allow a legal en passant capture", () => {
      const customBoard = chessEngine.initBoard().map(row => [...row]);
      customBoard[3][5] = "P";
      customBoard[3][4] = "p";
      customBoard[2][5] = ".";
      customBoard[2][4] = ".";

      const lastMove = { from: [1, 4], to: [3, 4], piece: "p" };
      const result = chessEngine.isValidMove(customBoard, [3, 5], [2, 4], "white", lastMove);

      expect(result.valid).toBe(true);
      expect(result.enPassant).toBe(true);
    });

    it("should reject castling when the king is currently in check", () => {
      const customBoard = [
        [".", ".", ".", ".", ".", ".", ".", "."],
        [".", ".", ".", ".", ".", ".", ".", "."],
        [".", ".", ".", ".", ".", ".", ".", "."],
        [".", ".", ".", ".", ".", ".", ".", "."],
        [".", ".", ".", ".", ".", ".", ".", "."],
        [".", ".", ".", ".", ".", ".", ".", "."],
        [".", ".", ".", ".", ".", ".", ".", "."],
        [".", ".", ".", ".", "K", ".", ".", "R"]
      ];
      customBoard[0][4] = "r";

      const result = chessEngine.isValidMove(customBoard, [7, 4], [7, 6], "white", null);
      expect(result.valid).toBe(false);
    });

    it("should promote a pawn to a queen on the last rank", () => {
      const customBoard = chessEngine.initBoard().map(row => [...row]);
      customBoard[1][0] = ".";
      customBoard[1][0] = "P";
      customBoard[0][0] = ".";

      const result = chessEngine.isValidMove(customBoard, [1, 0], [0, 0], "white", null);
      expect(result.valid).toBe(true);

      const movedBoard = chessEngine.makeMove(customBoard, [1, 0], [0, 0], null, false);
      expect(movedBoard[0][0]).toBe("Q");
    });
  });

  describe("makeMove", () => {
    let board;

    beforeEach(() => {
      board = chessEngine.initBoard();
    });

    it("should update the board state correctly", () => {
      const newBoard = chessEngine.makeMove(board, [6, 4], [4, 4], null, false);
      expect(newBoard[6][4]).toBe(".");
      expect(newBoard[4][4]).toBe("P");
    });
  });

  describe("isKingInCheck", () => {
    it("should detect when king is in check", () => {
      const board = [
        [".", ".", ".", ".", "k", ".", ".", "."],
        [".", ".", ".", ".", ".", ".", ".", "."],
        [".", ".", ".", ".", ".", ".", ".", "."],
        [".", ".", ".", ".", ".", ".", ".", "."],
        [".", ".", ".", ".", "R", ".", ".", "."],
        [".", ".", ".", ".", ".", ".", ".", "."],
        [".", ".", ".", ".", ".", ".", ".", "."],
        [".", ".", ".", ".", "K", ".", ".", "."]
      ];
      
      expect(chessEngine.isKingInCheck(board, "black")).toBe(true);
      expect(chessEngine.isKingInCheck(board, "white")).toBe(false);
    });
  });
});

describe("isValidFenStructure", () => {
  const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

  it("accepts valid FENs", () => {
    expect(chessEngine.isValidFenStructure(START)).toBe(true);
    expect(chessEngine.isValidFenStructure("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1")).toBe(true);
    expect(chessEngine.isValidFenStructure("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR  w - - 0 1")).toBe(true);
  });

  it("accepts FENs produced by boardToFen", () => {
    const fen = chessEngine.boardToFen(chessEngine.initBoard(), 'black', 3, 2);
    expect(chessEngine.isValidFenStructure(fen)).toBe(true);
  });

  it.each([
    [null], [undefined], [123], [{}], [""],
  ])("rejects non-string or empty input %p", (v) => {
    expect(chessEngine.isValidFenStructure(v)).toBe(false);
  });

  it("rejects strings over 128 characters", () => {
    expect(chessEngine.isValidFenStructure(START + " ".repeat(200))).toBe(false);
    expect(chessEngine.isValidFenStructure("a".repeat(5000))).toBe(false);
  });

  it("rejects wrong token counts", () => {
    expect(chessEngine.isValidFenStructure("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -")).toBe(false);
    expect(chessEngine.isValidFenStructure(START + " extra")).toBe(false);
  });

  it("rejects wrong rank count", () => {
    expect(chessEngine.isValidFenStructure("rnbqkbnr/pppppppp/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1")).toBe(false);
    expect(chessEngine.isValidFenStructure("rnbqkbnr/pppppppp/8/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1")).toBe(false);
  });

  it("rejects invalid active color, castling, en passant and counters", () => {
    expect(chessEngine.isValidFenStructure(START.replace(" w ", " x "))).toBe(false);
    expect(chessEngine.isValidFenStructure(START.replace("KQkq", "ZZ"))).toBe(false);
    expect(chessEngine.isValidFenStructure(START.replace(" - 0 1", " e5 0 1"))).toBe(false);
    expect(chessEngine.isValidFenStructure(START.replace(" 0 1", " a b"))).toBe(false);
  });

  it("rejects invalid piece characters", () => {
    expect(chessEngine.isValidFenStructure("xnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1")).toBe(false);
  });

  it("fenToBoard throws a sanitized error for invalid FEN", () => {
    expect(() => chessEngine.fenToBoard("garbage")).toThrow("Invalid FEN structure");
    expect(() => chessEngine.fenToBoard("a".repeat(5000))).toThrow("Invalid FEN structure");
    expect(() => chessEngine.fenToBoard(START)).not.toThrow();
  });
});

