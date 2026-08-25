class ChessEngine {
  constructor() {
    this.initBoard();
    this.moveCache = new Map();
    this.maxCacheSize = 10000;
  }

  initBoard() {
    return [
      ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'],
      ['p', 'p', 'p', 'p', 'p', 'p', 'p', 'p'],
      ['.', '.', '.', '.', '.', '.', '.', '.'],
      ['.', '.', '.', '.', '.', '.', '.', '.'],
      ['.', '.', '.', '.', '.', '.', '.', '.'],
      ['.', '.', '.', '.', '.', '.', '.', '.'],
      ['P', 'P', 'P', 'P', 'P', 'P', 'P', 'P'],
      ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R']
    ];
  }

  boardToFen(board) {
    return JSON.stringify(board);
  }

  getCachedMoveResult(board, from, to, turn, lastMove) {
    const cacheKey = `${this.boardToFen(board)}:${from[0]},${from[1]}:${to[0]},${to[1]}:${turn}`;
    return this.moveCache.get(cacheKey);
  }

  setCachedMoveResult(board, from, to, turn, lastMove, result) {
    if (this.moveCache.size >= this.maxCacheSize) {
      const firstKey = this.moveCache.keys().next().value;
      this.moveCache.delete(firstKey);
    }
    const cacheKey = `${this.boardToFen(board)}:${from[0]},${from[1]}:${to[0]},${to[1]}:${turn}`;
    this.moveCache.set(cacheKey, result);
  }

  clearCache() {
    this.moveCache.clear();
  }

  getCacheStats() {
    return { size: this.moveCache.size, maxSize: this.maxCacheSize };
  }

  isValidMove(board, from, to, turn, lastMove = null) {
    const cachedResult = this.getCachedMoveResult(board, from, to, turn, lastMove);
    if (cachedResult) return cachedResult;

    const [fromRow, fromCol] = from;
    const [toRow, toCol] = to;
    const piece = board[fromRow][fromCol];

    if (piece === '.') {
      const result = { valid: false, reason: 'No piece at source' };
      this.setCachedMoveResult(board, from, to, turn, lastMove, result);
      return result;
    }
    if ((turn === 'white' && piece === piece.toLowerCase()) ||
        (turn === 'black' && piece === piece.toUpperCase())) {
      const result = { valid: false, reason: 'Not your piece' };
      this.setCachedMoveResult(board, from, to, turn, lastMove, result);
      return result;
    }

    const target = board[toRow][toCol];
    if (target !== '.' &&
        ((turn === 'white' && target === target.toUpperCase()) ||
         (turn === 'black' && target === target.toLowerCase()))) {
      const result = { valid: false, reason: 'Cannot capture own piece' };
      this.setCachedMoveResult(board, from, to, turn, lastMove, result);
      return result;
    }

    const pieceLower = piece.toLowerCase();
    let isValid = false;
    let isEnPassant = false;

    switch (pieceLower) {
      case 'p':
        const pawnResult = this.isValidPawnMove(board, from, to, turn, lastMove);
        isValid = pawnResult.valid;
        isEnPassant = pawnResult.enPassant;
        break;
      case 'r': isValid = this.isValidRookMove(board, from, to); break;
      case 'n': isValid = this.isValidKnightMove(from, to); break;
      case 'b': isValid = this.isValidBishopMove(board, from, to); break;
      case 'q': isValid = this.isValidQueenMove(board, from, to); break;
      case 'k': isValid = this.isValidKingMove(from, to); break;
      default: {
        const result = { valid: false, reason: 'Unknown piece' };
        this.setCachedMoveResult(board, from, to, turn, lastMove, result);
        return result;
      }
    }

    if (!isValid) {
      const result = { valid: false, reason: 'Illegal move for piece' };
      this.setCachedMoveResult(board, from, to, turn, lastMove, result);
      return result;
    }

    const testBoard = this.makeMove(board, from, to, null, isEnPassant);
    if (this.isKingInCheck(testBoard, turn)) {
      const result = { valid: false, reason: 'Move leaves king in check' };
      this.setCachedMoveResult(board, from, to, turn, lastMove, result);
      return result;
    }

    const result = { valid: true, enPassant: isEnPassant };
    this.setCachedMoveResult(board, from, to, turn, lastMove, result);
    return result;
  }

  isValidPawnMove(board, from, to, turn, lastMove) {
    const [fromRow, fromCol] = from;
    const [toRow, toCol] = to;
    const direction = turn === 'white' ? -1 : 1;
    const startRow = turn === 'white' ? 6 : 1;
    const rowDiff = toRow - fromRow;
    const colDiff = Math.abs(toCol - fromCol);

    if (colDiff === 0) {
      if (rowDiff === direction && board[toRow][toCol] === '.') return { valid: true };
      if (fromRow === startRow && rowDiff === 2 * direction && 
          board[toRow][toCol] === '.' && board[fromRow + direction][fromCol] === '.') return { valid: true };
    } else if (colDiff === 1 && rowDiff === direction) {
      if (board[toRow][toCol] !== '.') return { valid: true };
      
      if (lastMove && lastMove.piece.toLowerCase() === 'p' && 
          Math.abs(lastMove.to[0] - lastMove.from[0]) === 2 &&
          lastMove.to[0] === fromRow && lastMove.to[1] === toCol) {
        return { valid: true, enPassant: true };
      }
    }
    return { valid: false };
  }

  isValidRookMove(board, from, to) {
    const [fromRow, fromCol] = from;
    const [toRow, toCol] = to;
    
    if (fromRow !== toRow && fromCol !== toCol) return false;
    return this.isPathClear(board, from, to);
  }

  isValidKnightMove(from, to) {
    const [fromRow, fromCol] = from;
    const [toRow, toCol] = to;
    const rowDiff = Math.abs(toRow - fromRow);
    const colDiff = Math.abs(toCol - fromCol);
    return (rowDiff === 2 && colDiff === 1) || (rowDiff === 1 && colDiff === 2);
  }

  isValidBishopMove(board, from, to) {
    const [fromRow, fromCol] = from;
    const [toRow, toCol] = to;
    
    if (Math.abs(toRow - fromRow) !== Math.abs(toCol - fromCol)) return false;
    return this.isPathClear(board, from, to);
  }

  isValidQueenMove(board, from, to) {
    return this.isValidRookMove(board, from, to) || this.isValidBishopMove(board, from, to);
  }

  isValidKingMove(from, to) {
    const [fromRow, fromCol] = from;
    const [toRow, toCol] = to;
    return Math.abs(toRow - fromRow) <= 1 && Math.abs(toCol - fromCol) <= 1;
  }

  isPathClear(board, from, to) {
    const [fromRow, fromCol] = from;
    const [toRow, toCol] = to;
    const rowStep = toRow > fromRow ? 1 : toRow < fromRow ? -1 : 0;
    const colStep = toCol > fromCol ? 1 : toCol < fromCol ? -1 : 0;
    
    let row = fromRow + rowStep;
    let col = fromCol + colStep;
    
    while (row !== toRow || col !== toCol) {
      if (board[row][col] !== '.') return false;
      row += rowStep;
      col += colStep;
    }
    return true;
  }

  makeMove(board, from, to, promotion = null, isEnPassant = false) {
    const newBoard = board.map(row => [...row]);
    const [fromRow, fromCol] = from;
    const [toRow, toCol] = to;
    const piece = newBoard[fromRow][fromCol];
    
    if (isEnPassant) {
      const captureRow = fromRow;
      newBoard[captureRow][toCol] = '.';
    }
    
    newBoard[toRow][toCol] = newBoard[fromRow][fromCol];
    newBoard[fromRow][fromCol] = '.';
    
    if (piece.toLowerCase() === 'p' && (toRow === 0 || toRow === 7)) {
      if (promotion) {
        newBoard[toRow][toCol] = piece === piece.toUpperCase() ? promotion.toUpperCase() : promotion.toLowerCase();
      }
    }
    
    return newBoard;
  }

  isKingInCheck(board, color) {
    let kingPos = null;
    const kingPiece = color === 'white' ? 'K' : 'k';
    
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (board[r][c] === kingPiece) {
          kingPos = [r, c];
          break;
        }
      }
      if (kingPos) break;
    }
    
    if (!kingPos) return false;
    
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = board[r][c];
        if (piece === '.') continue;
        const isOpponent = (color === 'white' && piece === piece.toLowerCase()) ||
                          (color === 'black' && piece === piece.toUpperCase());
        if (!isOpponent) continue;
        
        const pieceLower = piece.toLowerCase();
        let canAttack = false;
        
        switch (pieceLower) {
          case 'p': {
            const dir = piece === piece.toUpperCase() ? -1 : 1;
            canAttack = (kingPos[0] === r + dir && Math.abs(kingPos[1] - c) === 1);
            break;
          }
          case 'n': canAttack = this.isValidKnightMove([r, c], kingPos); break;
          case 'b': canAttack = this.isValidBishopMove(board, [r, c], kingPos); break;
          case 'r': canAttack = this.isValidRookMove(board, [r, c], kingPos); break;
          case 'q': canAttack = this.isValidQueenMove(board, [r, c], kingPos); break;
          case 'k': canAttack = this.isValidKingMove([r, c], kingPos); break;
        }
        
        if (canAttack) return true;
      }
    }
    
    return false;
  }

  hasLegalMoves(board, color, lastMove) {
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = board[r][c];
        if (piece === '.') continue;
        const isPlayerPiece = (color === 'white' && piece === piece.toUpperCase()) ||
                              (color === 'black' && piece === piece.toLowerCase());
        if (!isPlayerPiece) continue;
        
        for (let tr = 0; tr < 8; tr++) {
          for (let tc = 0; tc < 8; tc++) {
            const result = this.isValidMove(board, [r, c], [tr, tc], color, lastMove);
            if (result.valid) return true;
          }
        }
      }
    }
    return false;
  }

  isCheckmate(board, color, lastMove) {
    return this.isKingInCheck(board, color) && !this.hasLegalMoves(board, color, lastMove);
  }

  isStalemate(board, color, lastMove) {
    return !this.isKingInCheck(board, color) && !this.hasLegalMoves(board, color, lastMove);
  }

  /**
   * Convert board state to FEN (Forsyth-Edwards Notation)
   * @param {Array} board - Current board state
   * @param {string} color - Current player color
   * @param {number} moveCount - Half-move clock
   * @param {number} fullmoveNumber - Full move number
   * @returns {string} FEN string representation
   */
  boardToFen(board, color = 'white', moveCount = 0, fullmoveNumber = 1) {
    let fen = '';
    
    // Piece placement
    for (let r = 0; r < 8; r++) {
      let emptySquares = 0;
      for (let c = 0; c < 8; c++) {
        const piece = board[r][c];
        if (piece === '.') {
          emptySquares++;
        } else {
          if (emptySquares > 0) {
            fen += emptySquares;
            emptySquares = 0;
          }
          fen += piece;
        }
      }
      if (emptySquares > 0) {
        fen += emptySquares;
      }
      if (r < 7) fen += '/';
    }
    
    // Active color
    fen += ' ' + (color === 'white' ? 'w' : 'b');
    
    // Castling availability (simplified - no tracking in current implementation)
    fen += ' -';
    
    // En passant target square (simplified - not implemented)
    fen += ' -';
    
    // Halfmove clock
    fen += ' ' + moveCount;
    
    // Fullmove number
    fen += ' ' + fullmoveNumber;
    
    return fen;
  }

  /**
   * Convert FEN string to board state
   * @param {string} fen - FEN string
   * @returns {object} { board, currentColor, moveCount, fullmoveNumber }
   */
  fenToBoard(fen) {
    const parts = fen.split(' ');
    const position = parts[0];
    const currentColor = parts[1] === 'w' ? 'white' : 'black';
    const moveCount = parseInt(parts[3]) || 0;
    const fullmoveNumber = parseInt(parts[4]) || 1;
    
    const board = [];
    const ranks = position.split('/');
    
    for (const rank of ranks) {
      const row = [];
      for (const char of rank) {
        if (/\d/.test(char)) {
          for (let i = 0; i < parseInt(char); i++) {
            row.push('.');
          }
        } else {
          row.push(char);
        }
      }
      board.push(row);
    }
    
    return { board, currentColor, moveCount, fullmoveNumber };
  }

  /**
   * Generate SAN (Standard Algebraic Notation) for a move
   * @param {Array} board - Current board state
   * @param {Array} from - From position [row, col]
   * @param {Array} to - To position [row, col]
   * @param {string|null} promotion - Promotion piece
   * @returns {string} SAN notation
   */
  moveToSan(board, from, to, promotion = null) {
    const [fromRow, fromCol] = from;
    const [toRow, toCol] = to;
    const piece = board[fromRow][fromCol].toLowerCase();
    const target = board[toRow][toCol];
    const isCapture = target !== '.';
    
    let san = '';
    
    // Handle castling
    if (piece === 'k' && Math.abs(toCol - fromCol) === 2) {
      return toCol > fromCol ? 'O-O' : 'O-O-O';
    }
    
    // Piece notation
    if (piece !== 'p') {
      san += piece.toUpperCase();
    }
    
    // Capture notation
    if (isCapture) {
      if (piece === 'p') {
        san += String.fromCharCode(97 + fromCol);
      }
      san += 'x';
    } else if (piece === 'p') {
      // Pawn move without capture
      san += '';
    }
    
    // Destination square
    san += String.fromCharCode(97 + toCol) + (8 - toRow);
    
    // Promotion
    if (promotion) {
      san += '=' + promotion.toUpperCase();
    }
    
    return san;
  }

  /**
   * Validate and parse PGN move string
   * @param {string} sanMove - Move in SAN notation
   * @param {Array} board - Current board state
   * @param {string} color - Player color
   * @returns {object} { valid: boolean, from: [row, col], to: [row, col], promotion: string|null }
   */
  parseSanMove(sanMove, board, color) {
    try {
      // Remove check/checkmate symbols
      sanMove = sanMove.replace(/[+#]$/, '').trim();
      
      // Handle castling
      if (sanMove === 'O-O') {
        const fromRow = color === 'white' ? 7 : 0;
        return { 
          valid: true, 
          from: [fromRow, 4], 
          to: [fromRow, 6],
          promotion: null 
        };
      }
      if (sanMove === 'O-O-O') {
        const fromRow = color === 'white' ? 7 : 0;
        return { 
          valid: true, 
          from: [fromRow, 4], 
          to: [fromRow, 2],
          promotion: null 
        };
      }
      
      // Parse regular move
      const match = sanMove.match(/^([KQRBN])?([a-h])?([1-8])?(x)?([a-h])([1-8])(?:=([QRBN]))?$/);
      if (!match) return { valid: false };
      
      const [, pieceLetter, fromFile, fromRank, isCapture, toFile, toRank, promotion] = match;
      const toCol = toFile.charCodeAt(0) - 97;
      const toRow = 8 - parseInt(toRank);
      
      // Find the piece that can make this move
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          const piece = board[r][c];
          const isPlayerPiece = (color === 'white' && piece === piece.toUpperCase()) ||
                                (color === 'black' && piece === piece.toLowerCase());
          
          if (!isPlayerPiece) continue;
          
          const pieceLow = piece.toLowerCase();
          if (pieceLetter && pieceLetter.toLowerCase() !== pieceLow) continue;
          if (pieceLow === 'p' && fromFile && fromFile.charCodeAt(0) - 97 !== c) continue;
          
          const moveResult = this.isValidMove(board, [r, c], [toRow, toCol], color);
          if (moveResult.valid) {
            return {
              valid: true,
              from: [r, c],
              to: [toRow, toCol],
              promotion: promotion || null
            };
          }
        }
      }
      
      return { valid: false };
    } catch (error) {
      return { valid: false };
    }
  }

  /**
   * Generate full move history in PGN format from moves array
   * @param {Array} moves - Array of move objects with from, to, promotion
   * @param {Array} startBoard - Starting board state
   * @returns {string} PGN string
   */
  generatePgn(moves, startBoard = null) {
    if (!startBoard) {
      startBoard = this.initBoard();
    }
    
    let board = startBoard.map(row => [...row]);
    let pgn = '';
    let moveNumber = 1;
    let lastMove = null;
    
    for (const move of moves) {
      const color = moveNumber % 2 === 1 ? 'white' : 'black';
      
      if (color === 'white' && pgn) {
        pgn += ' ';
      }
      
      if (color === 'white') {
        pgn += moveNumber + '.';
      }
      
      const san = this.moveToSan(board, move.from, move.to, move.promotion);
      pgn += san;
      
      // Make the move on the board
      board = this.makeMove(board, move.from, move.to, move.promotion);
      
      if (color === 'black') {
        moveNumber++;
      }
      
      lastMove = move;
    }
    
    return pgn;
  }

  /**
   * Sync game state with FEN (validate FEN matches board state)
   * @param {Array} board - Current board state
   * @param {string} expectedFen - Expected FEN string
   * @returns {object} { valid: boolean, fen: string, differences: Array }
   */
  syncFenState(board, expectedFen, color = 'white', moveCount = 0, fullmoveNumber = 1) {
    const currentFen = this.boardToFen(board, color, moveCount, fullmoveNumber);
    const valid = currentFen === expectedFen;
    
    const differences = [];
    if (currentFen !== expectedFen) {
      differences.push({
        field: 'FEN',
        expected: expectedFen,
        actual: currentFen
      });
    }
    
    return {
      valid,
      fen: currentFen,
      differences
    };
  }
}

module.exports = new ChessEngine();
