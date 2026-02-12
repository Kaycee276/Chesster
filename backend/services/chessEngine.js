class ChessEngine {
  constructor() {
    this.initBoard();
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

  isValidMove(board, from, to, turn, lastMove = null) {
    const [fromRow, fromCol] = from;
    const [toRow, toCol] = to;
    const piece = board[fromRow][fromCol];
    
    if (piece === '.') return { valid: false, reason: 'No piece at source' };
    if ((turn === 'white' && piece === piece.toLowerCase()) || 
        (turn === 'black' && piece === piece.toUpperCase())) {
      return { valid: false, reason: 'Not your piece' };
    }

    const target = board[toRow][toCol];
    if (target !== '.' && 
        ((turn === 'white' && target === target.toUpperCase()) ||
         (turn === 'black' && target === target.toLowerCase()))) {
      return { valid: false, reason: 'Cannot capture own piece' };
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
      default: return { valid: false, reason: 'Unknown piece' };
    }

    if (!isValid) return { valid: false, reason: 'Illegal move for piece' };

    const testBoard = this.makeMove(board, from, to, null, isEnPassant);
    if (this.isKingInCheck(testBoard, turn)) {
      return { valid: false, reason: 'Move leaves king in check' };
    }

    return { valid: true, enPassant: isEnPassant };
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
}

module.exports = new ChessEngine();
