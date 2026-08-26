-- Migration: Token Wager Transaction Ledger Table (feat #79)
-- Records all token movements: deposits, wagers, refunds, payouts

CREATE TABLE IF NOT EXISTS token_wager_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_address VARCHAR(255) NOT NULL,
  transaction_type VARCHAR(50) NOT NULL,
  token_mint VARCHAR(255) NOT NULL,
  amount NUMERIC(38, 0) NOT NULL,
  tx_hash TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ledger_game_id ON token_wager_ledger(game_id);
CREATE INDEX IF NOT EXISTS idx_ledger_player_address ON token_wager_ledger(player_address);
CREATE INDEX IF NOT EXISTS idx_ledger_transaction_type ON token_wager_ledger(transaction_type);
CREATE INDEX IF NOT EXISTS idx_ledger_token_mint ON token_wager_ledger(token_mint);
CREATE INDEX IF NOT EXISTS idx_ledger_status ON token_wager_ledger(status);
CREATE INDEX IF NOT EXISTS idx_ledger_tx_hash ON token_wager_ledger(tx_hash) WHERE tx_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ledger_created_at ON token_wager_ledger(created_at);
CREATE INDEX IF NOT EXISTS idx_ledger_player_game ON token_wager_ledger(player_address, game_id);

-- Check constraint for valid transaction types
ALTER TABLE token_wager_ledger ADD CONSTRAINT chk_transaction_type
  CHECK (transaction_type IN ('deposit', 'wager_hold', 'wager_release', 'refund', 'payout', 'fee'));

-- Check constraint for valid status values
ALTER TABLE token_wager_ledger ADD CONSTRAINT chk_ledger_status
  CHECK (status IN ('pending', 'confirmed', 'failed', 'reversed'));

-- Row Level Security
ALTER TABLE token_wager_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations on token_wager_ledger" ON token_wager_ledger FOR ALL USING (true);
