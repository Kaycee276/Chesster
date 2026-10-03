-- Glicko-2 state for player ratings. Existing Elo values remain the rating
-- anchor so legacy leaderboard queries continue to work.
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS rating_deviation DOUBLE PRECISION NOT NULL DEFAULT 350.0,
  ADD COLUMN IF NOT EXISTS volatility DOUBLE PRECISION NOT NULL DEFAULT 0.06;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS rating_deviation DOUBLE PRECISION NOT NULL DEFAULT 350.0,
  ADD COLUMN IF NOT EXISTS volatility DOUBLE PRECISION NOT NULL DEFAULT 0.06;

CREATE INDEX IF NOT EXISTS idx_players_rating_deviation ON players (rating_deviation);
