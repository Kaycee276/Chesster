-- Migration: match audit log table for dispute resolution (feat #73)
-- Records immutable event history with timestamps and coordinator tx hashes

CREATE TABLE IF NOT EXISTS match_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL,
  event_data JSONB NOT NULL DEFAULT '{}',
  player_address VARCHAR(255),
  coordinator_tx_hash TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_audit_logs_game_id ON match_audit_logs(game_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type ON match_audit_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON match_audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_coordinator_tx ON match_audit_logs(coordinator_tx_hash) WHERE coordinator_tx_hash IS NOT NULL;

-- Row Level Security
ALTER TABLE match_audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations on match_audit_logs" ON match_audit_logs FOR ALL USING (true);
