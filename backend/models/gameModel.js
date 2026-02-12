const supabase = require('../config/supabase');
const chessEngine = require('../services/chessEngine');

class GameModel {
  async createGame(gameType = 'chess') {
    const gameCode = this.generateGameCode();
    const initialBoard = chessEngine.initBoard();
    
    const { data, error } = await supabase
      .from('games')
      .insert({
        game_code: gameCode,
        game_type: gameType,
        board_state: initialBoard,
        current_turn: 'white',
        status: 'waiting'
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async joinGame(gameCode, playerColor) {
    const { data: game, error: fetchError } = await supabase
      .from('games')
      .select('*')
      .eq('game_code', gameCode)
      .single();

    if (fetchError) throw fetchError;
    if (!game) throw new Error('Game not found');
    if (game.status !== 'waiting' && game.status !== 'active') throw new Error('Cannot join game');

    const updateField = playerColor === 'white' ? 'player_white' : 'player_black';
    const otherField = playerColor === 'white' ? 'player_black' : 'player_white';
    const bothPlayersJoined = game[otherField] === true;

    const { data, error } = await supabase
      .from('games')
      .update({ 
        [updateField]: true,
        status: bothPlayersJoined ? 'active' : 'waiting'
      })
      .eq('game_code', gameCode)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async getGame(gameCode) {
    const { data, error } = await supabase
      .from('games')
      .select('*')
      .eq('game_code', gameCode)
      .single();

    if (error) throw error;
    return data;
  }

  async makeMove(gameCode, from, to, promotion = null) {
    const game = await this.getGame(gameCode);
    
    if (game.status !== 'active') throw new Error('Game not active');

    const validation = chessEngine.isValidMove(game.board_state, from, to, game.current_turn, game.last_move);
    if (!validation.valid) throw new Error(validation.reason || 'Invalid move');

    const piece = game.board_state[from[0]][from[1]];
    const isPromotion = piece.toLowerCase() === 'p' && (to[0] === 0 || to[0] === 7);
    
    if (isPromotion && !promotion) {
      throw new Error('Promotion piece required');
    }

    const newBoard = chessEngine.makeMove(game.board_state, from, to, promotion, validation.enPassant);
    const nextTurn = game.current_turn === 'white' ? 'black' : 'white';
    const isCheck = chessEngine.isKingInCheck(newBoard, nextTurn);
    const isCheckmate = chessEngine.isCheckmate(newBoard, nextTurn, { from, to, piece });
    const isStalemate = chessEngine.isStalemate(newBoard, nextTurn, { from, to, piece });

    let newStatus = game.status;
    let winner = null;

    if (isCheckmate) {
      newStatus = 'finished';
      winner = game.current_turn;
    } else if (isStalemate) {
      newStatus = 'finished';
      winner = 'draw';
    }

    const { data: updatedGame, error: updateError } = await supabase
      .from('games')
      .update({
        board_state: newBoard,
        current_turn: nextTurn,
        last_move: { from, to, piece },
        in_check: isCheck,
        status: newStatus,
        winner: winner
      })
      .eq('game_code', gameCode)
      .select()
      .single();

    if (updateError) throw updateError;

    const { error: moveError } = await supabase
      .from('moves')
      .insert({
        game_id: game.id,
        move_number: game.move_count + 1,
        player: game.current_turn,
        from_position: from,
        to_position: to,
        piece: piece,
        board_state_after: newBoard,
        is_check: isCheck,
        is_checkmate: isCheckmate,
        promotion: promotion
      });

    if (moveError) throw moveError;

    await supabase
      .from('games')
      .update({ move_count: game.move_count + 1 })
      .eq('game_code', gameCode);

    return updatedGame;
  }

  async resignGame(gameCode, playerColor) {
    const winner = playerColor === 'white' ? 'black' : 'white';
    const { data, error } = await supabase
      .from('games')
      .update({ status: 'finished', winner })
      .eq('game_code', gameCode)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async offerDraw(gameCode, playerColor) {
    const { data, error } = await supabase
      .from('games')
      .update({ draw_offer: playerColor })
      .eq('game_code', gameCode)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async acceptDraw(gameCode) {
    const { data, error } = await supabase
      .from('games')
      .update({ status: 'finished', winner: 'draw', draw_offer: null })
      .eq('game_code', gameCode)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async getMoves(gameCode) {
    const game = await this.getGame(gameCode);
    
    const { data, error } = await supabase
      .from('moves')
      .select('*')
      .eq('game_id', game.id)
      .order('move_number', { ascending: true });

    if (error) throw error;
    return data;
  }

  generateGameCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }
}

module.exports = new GameModel();
