-- Migration: 032_create_escrow_settlement_ledger.sql
-- Description: Idempotent execution ledger for on-chain escrow settlements (Issue #645).
-- One row per match id guarantees a match is only ever settled once: the
-- UNIQUE constraint rejects a second concurrent insert, and `version` supports
-- optimistic-lock updates (UPDATE ... WHERE version = $expected).

-- UP
CREATE TABLE IF NOT EXISTS escrow_settlement_ledger (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id     VARCHAR(64) NOT NULL UNIQUE,
  tx_hash      TEXT,
  status       VARCHAR(16) NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'confirmed', 'failed')),
  attempts     INTEGER NOT NULL DEFAULT 1,
  last_error   TEXT,
  version      INTEGER NOT NULL DEFAULT 0,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_escrow_settlement_ledger_status
  ON escrow_settlement_ledger (status, submitted_at);

-- Written only by the backend service role; never exposed to clients.
ALTER TABLE escrow_settlement_ledger ENABLE ROW LEVEL SECURITY;

-- DOWN
DROP TABLE IF EXISTS escrow_settlement_ledger;
