export interface GameState {
  board_state: string[][];
  current_turn: 'white' | 'black';
  status: string;
  game_code?: string;
  player_white?: boolean;
  player_black?: boolean;
}
