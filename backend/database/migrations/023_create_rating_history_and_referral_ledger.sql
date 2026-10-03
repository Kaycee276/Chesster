-- Migration: 023_create_rating_history_and_referral_ledger.sql
-- Implements:
--   #319 — player_rating_history table for long-term Elo analytics
--   #320 — referral_program and claimable_commission_ledger tables

-- ─── #319: Player Rating History ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS player_rating_history (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT         NOT NULL REFERENCES players(wallet_address) ON DELETE CASCADE,
  game_id        UUID         REFERENCES games(id) ON DELETE SET NULL,
  time_category  TEXT         NOT NULL CHECK (time_category IN ('Bullet', 'Blitz', 'Rapid', 'Classical')),
  old_rating     INT          NOT NULL,
  delta          INT          NOT NULL,
  new_rating     INT          NOT NULL,
  recorded_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Fast chart queries: all history for a wallet sorted newest-first.
CREATE INDEX IF NOT EXISTS idx_rating_history_player
  ON player_rating_history (wallet_address, recorded_at DESC);

-- Allow efficient peak-rating lookups per category.
CREATE INDEX IF NOT EXISTS idx_rating_history_category
  ON player_rating_history (wallet_address, time_category, new_rating DESC);

-- Helper: record a rating change when a match concludes.
CREATE OR REPLACE FUNCTION record_rating_change(
  p_wallet_address TEXT,
  p_game_id        UUID,
  p_time_category  TEXT,
  p_old_rating     INT,
  p_delta          INT
)
RETURNS player_rating_history
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_rating INT;
  v_row        player_rating_history%ROWTYPE;
BEGIN
  v_new_rating := p_old_rating + p_delta;

  INSERT INTO player_rating_history
    (wallet_address, game_id, time_category, old_rating, delta, new_rating)
  VALUES
    (p_wallet_address, p_game_id, p_time_category, p_old_rating, p_delta, v_new_rating)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- ─── #320: Referral Program & Claimable Commission Ledger ────────────────────

-- Tracks active referral relationships between players.
CREATE TABLE IF NOT EXISTS referral_program (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_address TEXT         NOT NULL REFERENCES players(wallet_address) ON DELETE CASCADE,
  referred_address TEXT         NOT NULL REFERENCES players(wallet_address) ON DELETE CASCADE,
  referral_code    TEXT         NOT NULL,
  commission_bps   INT          NOT NULL DEFAULT 500 CHECK (commission_bps BETWEEN 0 AND 10000),
  status           TEXT         NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked')),
  referred_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at       TIMESTAMPTZ,
  UNIQUE (referred_address)  -- one referrer per referred player
);

CREATE INDEX IF NOT EXISTS idx_referral_referrer
  ON referral_program (referrer_address, status);

CREATE INDEX IF NOT EXISTS idx_referral_code
  ON referral_program (referral_code);

-- Ledger of commissions earned by referrers that are pending claim.
CREATE TABLE IF NOT EXISTS claimable_commission_ledger (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_address TEXT         NOT NULL REFERENCES players(wallet_address) ON DELETE CASCADE,
  source_game_id   UUID         REFERENCES games(id) ON DELETE SET NULL,
  amount_lumens    NUMERIC(20,7) NOT NULL CHECK (amount_lumens >= 0),
  status           TEXT          NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'claimed', 'expired')),
  earned_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  claimed_at       TIMESTAMPTZ,
  expires_at       TIMESTAMPTZ   GENERATED ALWAYS AS (earned_at + INTERVAL '90 days') STORED
);

CREATE INDEX IF NOT EXISTS idx_commission_referrer_pending
  ON claimable_commission_ledger (referrer_address, status)
  WHERE status = 'pending';

-- Helper: credit a commission entry from a completed game.
CREATE OR REPLACE FUNCTION credit_referral_commission(
  p_referrer_address TEXT,
  p_source_game_id   UUID,
  p_amount_lumens    NUMERIC(20,7)
)
RETURNS claimable_commission_ledger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row claimable_commission_ledger%ROWTYPE;
BEGIN
  INSERT INTO claimable_commission_ledger (referrer_address, source_game_id, amount_lumens)
  VALUES (p_referrer_address, p_source_game_id, p_amount_lumens)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- Helper: atomically mark commissions as claimed and return total claimed.
CREATE OR REPLACE FUNCTION claim_commissions(
  p_referrer_address TEXT
)
RETURNS NUMERIC(20,7)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total NUMERIC(20,7);
BEGIN
  UPDATE claimable_commission_ledger
  SET    status     = 'claimed',
         claimed_at = NOW()
  WHERE  referrer_address = p_referrer_address
    AND  status           = 'pending'
    AND  expires_at       > NOW()
  RETURNING SUM(amount_lumens) INTO v_total;

  RETURN COALESCE(v_total, 0);
END;
$$;

-- ─── DOWN ─────────────────────────────────────────────────────────────────────
-- DROP FUNCTION IF EXISTS claim_commissions(TEXT);
-- DROP FUNCTION IF EXISTS credit_referral_commission(TEXT, UUID, NUMERIC);
-- DROP TABLE  IF EXISTS claimable_commission_ledger;
-- DROP TABLE  IF EXISTS referral_program;
-- DROP FUNCTION IF EXISTS record_rating_change(TEXT, UUID, TEXT, INT, INT);
-- DROP TABLE  IF EXISTS player_rating_history;
