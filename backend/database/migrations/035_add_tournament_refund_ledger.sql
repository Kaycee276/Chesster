ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

CREATE TABLE IF NOT EXISTS tournament_refund_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL,
  amount NUMERIC(30, 7) NOT NULL CHECK (amount >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'refunded', 'failed')),
  tx_hash TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tournament_id, wallet_address)
);

-- Rollback: DROP TABLE IF EXISTS tournament_refund_ledger; ALTER TABLE tournaments DROP COLUMN IF EXISTS cancellation_reason;
