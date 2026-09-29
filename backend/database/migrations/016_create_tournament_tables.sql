-- Migration 016: Enhance tournament bracket & participant tables for full tournament ops.
-- Idempotent: safe to re-run. Upgrades schema introduced in 010_create_tournaments_schema.sql.
-- Adds seed rankings, round tracking, match dependencies, on-chain payout hashes,
-- status constraints, indexes, and RLS (public read / authenticated+coordinator write).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. tournaments (create if missing, then upgrade columns)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tournaments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120) NOT NULL,
  title VARCHAR(160),
  entry_fee NUMERIC(18, 7) NOT NULL DEFAULT 0 CHECK (entry_fee >= 0),
  max_players INTEGER NOT NULL CHECK (max_players >= 2),
  status VARCHAR(20) NOT NULL DEFAULT 'open'
    CHECK (status IN ('draft', 'open', 'active', 'in_progress', 'completed', 'cancelled')),
  current_round INTEGER NOT NULL DEFAULT 0 CHECK (current_round >= 0),
  winner_address TEXT,
  coordinator_address TEXT,
  payout_tx_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Upgrade columns when 010 already created a leaner table
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS title VARCHAR(160);
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS entry_fee NUMERIC(18, 7) NOT NULL DEFAULT 0;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS current_round INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS winner_address TEXT;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS coordinator_address TEXT;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS payout_tx_hash TEXT;

-- Relax / replace status check to include open|active|completed|cancelled (+ legacy draft/in_progress)
DO $$
DECLARE
  cname TEXT;
BEGIN
  FOR cname IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'tournaments'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE tournaments DROP CONSTRAINT IF EXISTS %I', cname);
  END LOOP;

  ALTER TABLE tournaments
    ADD CONSTRAINT tournaments_status_check
    CHECK (status IN ('draft', 'open', 'active', 'in_progress', 'completed', 'cancelled'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 2. tournament_participants
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tournament_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL,
  seed_number INTEGER CHECK (seed_number IS NULL OR seed_number > 0),
  seed INTEGER CHECK (seed IS NULL OR seed > 0),
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'eliminated', 'withdrawn', 'disqualified')),
  UNIQUE (tournament_id, wallet_address)
);

-- Upgrade path from 010 (composite PK without id / seed_number / status)
ALTER TABLE tournament_participants ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();
ALTER TABLE tournament_participants ADD COLUMN IF NOT EXISTS seed_number INTEGER;
ALTER TABLE tournament_participants ADD COLUMN IF NOT EXISTS registered_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE tournament_participants ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';

-- Backfill seed_number from legacy seed column when present
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tournament_participants' AND column_name = 'seed'
  ) THEN
    EXECUTE 'UPDATE tournament_participants SET seed_number = seed WHERE seed_number IS NULL AND seed IS NOT NULL';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tournament_participants' AND column_name = 'joined_at'
  ) THEN
    EXECUTE 'UPDATE tournament_participants SET registered_at = joined_at WHERE registered_at IS NULL';
  END IF;
END $$;

-- Ensure unique registration constraint exists (010 used composite PK; keep uniqueness)
DO $$
BEGIN
  ALTER TABLE tournament_participants
    ADD CONSTRAINT tournament_participants_tournament_id_wallet_address_key
    UNIQUE (tournament_id, wallet_address);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN unique_violation THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE tournament_participants
    ADD CONSTRAINT tournament_participants_status_check
    CHECK (status IN ('active', 'eliminated', 'withdrawn', 'disqualified'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 3. bracket_matches (with match dependency + winner indexing support)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bracket_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round INTEGER NOT NULL CHECK (round > 0),
  match_number INTEGER NOT NULL CHECK (match_number > 0),
  player_one TEXT,
  player_two TEXT,
  player_white TEXT,
  player_black TEXT,
  winner TEXT,
  winner_address TEXT,
  game_code VARCHAR(10),
  depends_on_match_a UUID REFERENCES bracket_matches(id) ON DELETE SET NULL,
  depends_on_match_b UUID REFERENCES bracket_matches(id) ON DELETE SET NULL,
  next_match_id UUID REFERENCES bracket_matches(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'ready', 'in_progress', 'completed', 'bye', 'cancelled')),
  payout_tx_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tournament_id, round, match_number)
);

ALTER TABLE bracket_matches ADD COLUMN IF NOT EXISTS player_white TEXT;
ALTER TABLE bracket_matches ADD COLUMN IF NOT EXISTS player_black TEXT;
ALTER TABLE bracket_matches ADD COLUMN IF NOT EXISTS winner_address TEXT;
ALTER TABLE bracket_matches ADD COLUMN IF NOT EXISTS depends_on_match_a UUID;
ALTER TABLE bracket_matches ADD COLUMN IF NOT EXISTS depends_on_match_b UUID;
ALTER TABLE bracket_matches ADD COLUMN IF NOT EXISTS next_match_id UUID;
ALTER TABLE bracket_matches ADD COLUMN IF NOT EXISTS payout_tx_hash TEXT;
ALTER TABLE bracket_matches ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE bracket_matches ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Sync winner_address from winner when unset
UPDATE bracket_matches
SET winner_address = winner
WHERE winner_address IS NULL AND winner IS NOT NULL;

DO $$
BEGIN
  ALTER TABLE bracket_matches
    ADD CONSTRAINT bracket_matches_depends_on_match_a_fkey
    FOREIGN KEY (depends_on_match_a) REFERENCES bracket_matches(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE bracket_matches
    ADD CONSTRAINT bracket_matches_depends_on_match_b_fkey
    FOREIGN KEY (depends_on_match_b) REFERENCES bracket_matches(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE bracket_matches
    ADD CONSTRAINT bracket_matches_next_match_id_fkey
    FOREIGN KEY (next_match_id) REFERENCES bracket_matches(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Indexes for rapid bracket tree assembly
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_tournament_participants_tournament_id
  ON tournament_participants (tournament_id);
CREATE INDEX IF NOT EXISTS idx_tournament_participants_wallet
  ON tournament_participants (wallet_address);
CREATE INDEX IF NOT EXISTS idx_tournament_participants_seed
  ON tournament_participants (tournament_id, seed_number);

CREATE INDEX IF NOT EXISTS idx_bracket_tournament_round
  ON bracket_matches (tournament_id, round);
CREATE INDEX IF NOT EXISTS idx_bracket_matches_tournament_round
  ON bracket_matches (tournament_id, round, match_number);
CREATE INDEX IF NOT EXISTS idx_bracket_matches_winner_address
  ON bracket_matches (winner_address);
CREATE INDEX IF NOT EXISTS idx_tournaments_winner_address
  ON tournaments (winner_address);
CREATE INDEX IF NOT EXISTS idx_tournaments_status
  ON tournaments (status);

-- ---------------------------------------------------------------------------
-- 5. Row-Level Security — public read; authenticated / coordinator updates
-- ---------------------------------------------------------------------------
ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE bracket_matches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tournaments_select_policy ON tournaments;
DROP POLICY IF EXISTS tournaments_insert_policy ON tournaments;
DROP POLICY IF EXISTS tournaments_update_policy ON tournaments;
DROP POLICY IF EXISTS tournament_participants_select_policy ON tournament_participants;
DROP POLICY IF EXISTS tournament_participants_insert_policy ON tournament_participants;
DROP POLICY IF EXISTS tournament_participants_update_policy ON tournament_participants;
DROP POLICY IF EXISTS bracket_matches_select_policy ON bracket_matches;
DROP POLICY IF EXISTS bracket_matches_insert_policy ON bracket_matches;
DROP POLICY IF EXISTS bracket_matches_update_policy ON bracket_matches;

-- Public read
CREATE POLICY tournaments_select_policy ON tournaments
  FOR SELECT USING (true);

CREATE POLICY tournament_participants_select_policy ON tournament_participants
  FOR SELECT USING (true);

CREATE POLICY bracket_matches_select_policy ON bracket_matches
  FOR SELECT USING (true);

-- Inserts: service role, open registration, or authenticated wallet self-register
CREATE POLICY tournaments_insert_policy ON tournaments
  FOR INSERT
  WITH CHECK (
    auth.role() = 'service_role'
    OR auth.jwt() IS NULL
    OR auth.jwt() ->> 'wallet_address' = coordinator_address
  );

CREATE POLICY tournament_participants_insert_policy ON tournament_participants
  FOR INSERT
  WITH CHECK (
    auth.role() = 'service_role'
    OR auth.jwt() IS NULL
    OR auth.jwt() ->> 'wallet_address' = wallet_address
  );

CREATE POLICY bracket_matches_insert_policy ON bracket_matches
  FOR INSERT
  WITH CHECK (
    auth.role() = 'service_role'
    OR auth.jwt() IS NULL
    OR EXISTS (
      SELECT 1 FROM tournaments t
      WHERE t.id = bracket_matches.tournament_id
        AND (
          t.coordinator_address = auth.jwt() ->> 'wallet_address'
          OR auth.role() = 'service_role'
        )
    )
  );

-- Updates: coordinator or service role (participants may update own row status)
CREATE POLICY tournaments_update_policy ON tournaments
  FOR UPDATE
  USING (
    auth.role() = 'service_role'
    OR auth.jwt() IS NULL
    OR coordinator_address = auth.jwt() ->> 'wallet_address'
  );

CREATE POLICY tournament_participants_update_policy ON tournament_participants
  FOR UPDATE
  USING (
    auth.role() = 'service_role'
    OR auth.jwt() IS NULL
    OR wallet_address = auth.jwt() ->> 'wallet_address'
    OR EXISTS (
      SELECT 1 FROM tournaments t
      WHERE t.id = tournament_participants.tournament_id
        AND t.coordinator_address = auth.jwt() ->> 'wallet_address'
    )
  );

CREATE POLICY bracket_matches_update_policy ON bracket_matches
  FOR UPDATE
  USING (
    auth.role() = 'service_role'
    OR auth.jwt() IS NULL
    OR EXISTS (
      SELECT 1 FROM tournaments t
      WHERE t.id = bracket_matches.tournament_id
        AND t.coordinator_address = auth.jwt() ->> 'wallet_address'
    )
  );

-- Rollback helper (manual):
-- DROP POLICY IF EXISTS tournaments_select_policy ON tournaments;
-- DROP POLICY IF EXISTS tournaments_insert_policy ON tournaments;
-- DROP POLICY IF EXISTS tournaments_update_policy ON tournaments;
-- DROP POLICY IF EXISTS tournament_participants_select_policy ON tournament_participants;
-- DROP POLICY IF EXISTS tournament_participants_insert_policy ON tournament_participants;
-- DROP POLICY IF EXISTS tournament_participants_update_policy ON tournament_participants;
-- DROP POLICY IF EXISTS bracket_matches_select_policy ON bracket_matches;
-- DROP POLICY IF EXISTS bracket_matches_insert_policy ON bracket_matches;
-- DROP POLICY IF EXISTS bracket_matches_update_policy ON bracket_matches;
-- ALTER TABLE bracket_matches DROP COLUMN IF EXISTS depends_on_match_a, DROP COLUMN IF EXISTS depends_on_match_b,
--   DROP COLUMN IF EXISTS next_match_id, DROP COLUMN IF EXISTS winner_address, DROP COLUMN IF EXISTS payout_tx_hash;
-- ALTER TABLE tournaments DROP COLUMN IF EXISTS entry_fee, DROP COLUMN IF EXISTS current_round,
--   DROP COLUMN IF EXISTS winner_address, DROP COLUMN IF EXISTS coordinator_address, DROP COLUMN IF EXISTS payout_tx_hash;
-- DROP TABLE IF EXISTS bracket_matches, tournament_participants, tournaments;
