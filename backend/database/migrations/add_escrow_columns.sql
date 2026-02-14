-- Database schema additions for escrow integration

-- Add player wallet address columns to games table
ALTER TABLE games ADD COLUMN IF NOT EXISTS player_white_address VARCHAR;
ALTER TABLE games ADD COLUMN IF NOT EXISTS player_black_address VARCHAR;
ALTER TABLE games ADD COLUMN IF NOT EXISTS wager_amount NUMERIC;
ALTER TABLE games ADD COLUMN IF NOT EXISTS token_address VARCHAR;
ALTER TABLE games ADD COLUMN IF NOT EXISTS escrow_status VARCHAR DEFAULT 'pending' CHECK (escrow_status IN ('pending', 'active', 'resolved', 'refunded'));

-- Example migration up (if using migration system)
-- CREATE TABLE games_v2 AS
-- SELECT 
--   id, game_code, game_type, board_state, current_turn, status,
--   player_white, player_black, NULL as player_white_address, NULL as player_black_address,
--   NULL as wager_amount, NULL as token_address, 'pending' as escrow_status,
--   created_at, updated_at
-- FROM games;
--
-- DROP TABLE games;
-- ALTER TABLE games_v2 RENAME TO games;
-- ALTER TABLE games ADD PRIMARY KEY (id);
-- CREATE UNIQUE INDEX games_code ON games(game_code);
