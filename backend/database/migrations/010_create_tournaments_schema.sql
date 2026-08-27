-- Tournament state and bracket relationships. Safe to run more than once.
CREATE TABLE IF NOT EXISTS tournaments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'open', 'in_progress', 'completed', 'cancelled')),
  max_players INTEGER NOT NULL CHECK (max_players >= 2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tournament_participants (
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  wallet_address VARCHAR(255) NOT NULL,
  seed INTEGER CHECK (seed IS NULL OR seed > 0),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tournament_id, wallet_address),
  UNIQUE (tournament_id, seed)
);

CREATE TABLE IF NOT EXISTS bracket_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round INTEGER NOT NULL CHECK (round > 0),
  match_number INTEGER NOT NULL CHECK (match_number > 0),
  player_one VARCHAR(255),
  player_two VARCHAR(255),
  winner VARCHAR(255),
  game_code VARCHAR(10),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'ready', 'in_progress', 'completed', 'bye')),
  UNIQUE (tournament_id, round, match_number)
);

CREATE INDEX IF NOT EXISTS idx_tournament_participants_wallet
  ON tournament_participants (wallet_address);
CREATE INDEX IF NOT EXISTS idx_bracket_matches_tournament_round
  ON bracket_matches (tournament_id, round, match_number);

-- Rollback: DROP TABLE IF EXISTS bracket_matches, tournament_participants, tournaments;
