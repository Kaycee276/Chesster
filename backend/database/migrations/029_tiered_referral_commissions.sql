-- Set referral commission rates from the cumulative settled wager volume of
-- every account referred by a given wallet.

CREATE OR REPLACE FUNCTION get_referrer_tier(p_referrer_wallet VARCHAR)
RETURNS TABLE (
  total_referred_volume NUMERIC,
  tier TEXT,
  commission_bps INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_volume NUMERIC;
BEGIN
  SELECT COALESCE(SUM(g.wager_amount), 0)
  INTO v_total_volume
  FROM users u
  JOIN games g
    ON g.player_white_address = u.wallet_address
    OR g.player_black_address = u.wallet_address
  WHERE u.referred_by_wallet = p_referrer_wallet
    AND g.escrow_status = 'settled'
    AND g.status IN ('finished', 'completed');

  RETURN QUERY
  SELECT
    v_total_volume,
    CASE
      WHEN v_total_volume >= 2500 THEN 'gold'
      WHEN v_total_volume >= 500 THEN 'silver'
      ELSE 'bronze'
    END,
    CASE
      WHEN v_total_volume >= 2500 THEN 2000
      WHEN v_total_volume >= 500 THEN 1500
      ELSE 1000
    END;
END;
$$;

CREATE OR REPLACE FUNCTION credit_referral_commission(
  p_game_id UUID,
  p_rake_amount NUMERIC,
  p_loser_wallet VARCHAR
) RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_referrer_wallet VARCHAR(255);
  v_commission_bps INTEGER;
  v_commission NUMERIC(30, 0);
BEGIN
  SELECT referred_by_wallet INTO v_referrer_wallet
  FROM users
  WHERE wallet_address = p_loser_wallet;

  IF v_referrer_wallet IS NULL THEN
    RETURN 0;
  END IF;

  SELECT tier.commission_bps INTO v_commission_bps
  FROM get_referrer_tier(v_referrer_wallet) AS tier;

  v_commission := TRUNC(p_rake_amount * v_commission_bps / 10000);
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
