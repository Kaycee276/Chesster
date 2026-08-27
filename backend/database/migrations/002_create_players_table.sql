-- Player profile and rating data. Safe to run more than once.
CREATE TABLE IF NOT EXISTS players (
  wallet_address VARCHAR(255) PRIMARY KEY,
  username VARCHAR(50),
  elo_rating INTEGER NOT NULL DEFAULT 1200 CHECK (elo_rating >= 0),
  wins INTEGER NOT NULL DEFAULT 0 CHECK (wins >= 0),
  losses INTEGER NOT NULL DEFAULT 0 CHECK (losses >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_players_elo_rating ON players (elo_rating DESC);
CREATE INDEX IF NOT EXISTS idx_players_updated_at ON players (updated_at DESC);

CREATE OR REPLACE FUNCTION update_players_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS players_updated_at ON players;
CREATE TRIGGER players_updated_at BEFORE UPDATE ON players
FOR EACH ROW EXECUTE FUNCTION update_players_updated_at();

-- Rollback: DROP TABLE IF EXISTS players;
