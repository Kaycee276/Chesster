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

  isValidMove(board, from, to, turn) {
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

    switch (pieceLower) {
      case 'p': isValid = this.isValidPawnMove(board, from, to, turn); break;
      case 'r': isValid = this.isValidRookMove(board, from, to); break;
      case 'n': isValid = this.isValidKnightMove(from, to); break;
      case 'b': isValid = this.isValidBishopMove(board, from, to); break;
      case 'q': isValid = this.isValidQueenMove(board, from, to); break;
      case 'k': isValid = this.isValidKingMove(from, to); break;
      default: return { valid: false, reason: 'Unknown piece' };
    }

    return isValid ? { valid: true } : { valid: false, reason: 'Illegal move for piece' };
  }

  isValidPawnMove(board, from, to, turn) {
    const [fromRow, fromCol] = from;
    const [toRow, toCol] = to;
    const direction = turn === 'white' ? -1 : 1;
    const startRow = turn === 'white' ? 6 : 1;
    const rowDiff = toRow - fromRow;
    const colDiff = Math.abs(toCol - fromCol);

    if (colDiff === 0) {
      if (rowDiff === direction && board[toRow][toCol] === '.') return true;
      if (fromRow === startRow && rowDiff === 2 * direction && 
          board[toRow][toCol] === '.' && board[fromRow + direction][fromCol] === '.') return true;
    } else if (colDiff === 1 && rowDiff === direction) {
      if (board[toRow][toCol] !== '.') return true;
    }
    return false;
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

  makeMove(board, from, to) {
    const newBoard = board.map(row => [...row]);
    const [fromRow, fromCol] = from;
    const [toRow, toCol] = to;
    
    newBoard[toRow][toCol] = newBoard[fromRow][fromCol];
    newBoard[fromRow][fromCol] = '.';
    
    return newBoard;
  }
}

module.exports = new ChessEngine();
