-- Migration 017: composite indexes for player history and active game lookups.
--
-- The repository migration runner wraps each migration in a transaction, so
-- these indexes intentionally use transactional CREATE INDEX statements rather
-- than CREATE INDEX CONCURRENTLY (which PostgreSQL rejects inside a transaction).
-- Each index is idempotent and matches the columns used by gameModel queries.

CREATE INDEX IF NOT EXISTS idx_games_white_player_created_at
  ON games (player_white_address, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_games_black_player_created_at
  ON games (player_black_address, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_games_status_created_at
  ON games (status, created_at DESC);

-- DOWN

DROP INDEX IF EXISTS idx_games_white_player_created_at;
DROP INDEX IF EXISTS idx_games_black_player_created_at;
DROP INDEX IF EXISTS idx_games_status_created_at;
