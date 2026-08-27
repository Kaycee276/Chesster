-- Query indexes for games, move history, and player wallet lookups.
-- Safe to run more than once during local or hosted migrations.

CREATE INDEX IF NOT EXISTS idx_games_status ON games (status);
CREATE INDEX IF NOT EXISTS idx_games_created_at ON games (created_at);
CREATE INDEX IF NOT EXISTS idx_games_player_white_address ON games (player_white_address);
CREATE INDEX IF NOT EXISTS idx_games_player_black_address ON games (player_black_address);
CREATE INDEX IF NOT EXISTS idx_moves_game_id_created_at ON moves (game_id, created_at);
