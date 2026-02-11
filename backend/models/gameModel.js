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
    if (game.status !== 'waiting') throw new Error('Game already started');

    const updateField = playerColor === 'white' ? 'player_white' : 'player_black';
    const { data, error } = await supabase
      .from('games')
      .update({ 
        [updateField]: true,
        status: game.player_white && game.player_black ? 'active' : 'waiting'
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

  async makeMove(gameCode, from, to) {
    const game = await this.getGame(gameCode);
    
    if (game.status !== 'active') throw new Error('Game not active');

    const validation = chessEngine.isValidMove(game.board_state, from, to, game.current_turn);
    if (!validation.valid) throw new Error(validation.reason || 'Invalid move');

    const newBoard = chessEngine.makeMove(game.board_state, from, to);
    const nextTurn = game.current_turn === 'white' ? 'black' : 'white';

    const { data: updatedGame, error: updateError } = await supabase
      .from('games')
      .update({
        board_state: newBoard,
        current_turn: nextTurn
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
        piece: game.board_state[from[0]][from[1]],
        board_state_after: newBoard
      });

    if (moveError) throw moveError;

    await supabase
      .from('games')
      .update({ move_count: game.move_count + 1 })
      .eq('game_code', gameCode);

    return updatedGame;
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
