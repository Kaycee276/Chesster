-- Add composite index on Move table for move sequence lookups
-- This index allows efficient retrieval of all moves for a game ordered by move_number
CREATE INDEX IF NOT EXISTS "idx_moves_game_id_move_number" ON "moves"("game_id", "move_number" ASC);
