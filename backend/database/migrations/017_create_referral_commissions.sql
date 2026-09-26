-- Referral attribution and claimable commission ledger.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS referral_code VARCHAR(8),
  ADD COLUMN IF NOT EXISTS referred_by_wallet VARCHAR(255),
  ADD COLUMN IF NOT EXISTS claimable_commission NUMERIC(30, 0) NOT NULL DEFAULT 0;

UPDATE users
SET referral_code = UPPER(SUBSTRING(REPLACE(id::text, '-', '') FROM 1 FOR 8))
WHERE referral_code IS NULL;

ALTER TABLE users ALTER COLUMN referral_code SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);
CREATE INDEX IF NOT EXISTS idx_users_referred_by_wallet ON users(referred_by_wallet);

CREATE TABLE IF NOT EXISTS referral_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_wallet VARCHAR(255) NOT NULL,
  amount NUMERIC(30, 0) NOT NULL CHECK (amount > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'failed')),
  payout_tx_hash TEXT,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS referral_rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_wallet VARCHAR(255) NOT NULL,
  source_game_id UUID NOT NULL,
  amount NUMERIC(30, 0) NOT NULL CHECK (amount > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'claimable'
    CHECK (status IN ('claimable', 'pending', 'claimed')),
  claim_id UUID REFERENCES referral_claims(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  UNIQUE (source_game_id)
);

CREATE INDEX IF NOT EXISTS idx_referral_rewards_wallet_status
  ON referral_rewards(referrer_wallet, status);

CREATE OR REPLACE FUNCTION credit_referral_commission(
  p_game_id UUID,
  p_rake_amount NUMERIC,
  p_loser_wallet VARCHAR
) RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_referrer_wallet VARCHAR(255);
  v_commission NUMERIC(30, 0);
BEGIN
  SELECT referred_by_wallet INTO v_referrer_wallet
  FROM users
  WHERE wallet_address = p_loser_wallet;

  IF v_referrer_wallet IS NULL THEN
    RETURN 0;
  END IF;

  v_commission := TRUNC(p_rake_amount * 20 / 100);
  IF v_commission <= 0 THEN
    RETURN 0;
  END IF;

  INSERT INTO referral_rewards (referrer_wallet, source_game_id, amount)
  VALUES (v_referrer_wallet, p_game_id, v_commission)
  ON CONFLICT (source_game_id) DO NOTHING;

  IF FOUND THEN
    UPDATE users
    SET claimable_commission = claimable_commission + v_commission,
        updated_at = NOW()
    WHERE wallet_address = v_referrer_wallet;
    RETURN v_commission;
  END IF;

  RETURN 0;
END;
$$;

CREATE OR REPLACE FUNCTION begin_referral_commission_claim(p_referrer_wallet VARCHAR)
RETURNS TABLE(claim_id UUID, amount NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_claim_id UUID;
  v_amount NUMERIC(30, 0);
BEGIN
  SELECT claimable_commission INTO v_amount
  FROM users
  WHERE wallet_address = p_referrer_wallet
  FOR UPDATE;

  IF v_amount IS NULL THEN
    RAISE EXCEPTION 'Referrer profile not found';
  END IF;
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'No commission available to claim';
  END IF;

  INSERT INTO referral_claims (referrer_wallet, amount)
  VALUES (p_referrer_wallet, v_amount)
  RETURNING id INTO v_claim_id;

  UPDATE referral_rewards
  SET status = 'pending', claim_id = v_claim_id
  WHERE referrer_wallet = p_referrer_wallet AND status = 'claimable';

  UPDATE users
  SET claimable_commission = 0, updated_at = NOW()
  WHERE wallet_address = p_referrer_wallet;

  RETURN QUERY SELECT v_claim_id, v_amount;
END;
$$;

CREATE OR REPLACE FUNCTION complete_referral_commission_claim(
  p_claim_id UUID,
  p_payout_tx_hash TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE referral_claims
  SET status = 'completed', payout_tx_hash = p_payout_tx_hash, completed_at = NOW()
  WHERE id = p_claim_id AND status = 'pending';

  UPDATE referral_rewards
  SET status = 'claimed', claimed_at = NOW()
  WHERE claim_id = p_claim_id AND status = 'pending';
END;
$$;

CREATE OR REPLACE FUNCTION fail_referral_commission_claim(
  p_claim_id UUID,
  p_failure_reason TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_wallet VARCHAR(255);
  v_amount NUMERIC(30, 0);
BEGIN
  UPDATE referral_claims
  SET status = 'failed', failure_reason = LEFT(p_failure_reason, 500)
  WHERE id = p_claim_id AND status = 'pending'
  RETURNING referrer_wallet, amount INTO v_wallet, v_amount;

  IF v_wallet IS NOT NULL THEN
    UPDATE referral_rewards
    SET status = 'claimable', claim_id = NULL
    WHERE claim_id = p_claim_id AND status = 'pending';

    UPDATE users
    SET claimable_commission = claimable_commission + v_amount, updated_at = NOW()
    WHERE wallet_address = v_wallet;
  END IF;
END;
$$;

-- DOWN
DROP FUNCTION IF EXISTS fail_referral_commission_claim(UUID, TEXT);
DROP FUNCTION IF EXISTS complete_referral_commission_claim(UUID, TEXT);
DROP FUNCTION IF EXISTS begin_referral_commission_claim(VARCHAR);
DROP FUNCTION IF EXISTS credit_referral_commission(UUID, NUMERIC, VARCHAR);
DROP TABLE IF EXISTS referral_rewards;
DROP TABLE IF EXISTS referral_claims;
DROP INDEX IF EXISTS idx_users_referred_by_wallet;
DROP INDEX IF EXISTS idx_users_referral_code;
ALTER TABLE users
  DROP COLUMN IF EXISTS claimable_commission,
  DROP COLUMN IF EXISTS referred_by_wallet,
  DROP COLUMN IF EXISTS referral_code;
