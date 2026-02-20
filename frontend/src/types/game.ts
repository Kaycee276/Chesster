export interface GameState {
	board_state: string[][];
	current_turn: "white" | "black";
	status: string;
	game_code?: string;
	player_white?: boolean;
	player_black?: boolean;
	in_check?: boolean;
	last_move?: { from: [number, number]; to: [number, number]; piece: string };
	captured_white?: string[];
	captured_black?: string[];
	winner?: string | null;
	draw_offer?: string | null;
	turn_started_at?: string | null;
}
