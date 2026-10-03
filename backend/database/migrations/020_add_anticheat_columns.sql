-- Persist anti-cheat telemetry, game scores, and manual-review flags.

ALTER TABLE match_audit_logs
  ADD COLUMN IF NOT EXISTS move_timestamp_ms BIGINT,
  ADD COLUMN IF NOT EXISTS move_duration_ms INTEGER,
  ADD COLUMN IF NOT EXISTS engine_top_move VARCHAR(8),
  ADD COLUMN IF NOT EXISTS centipawn_loss INTEGER;

ALTER TABLE games
  ADD COLUMN IF NOT EXISTS white_cheat_suspicion NUMERIC(5, 4),
  ADD COLUMN IF NOT EXISTS black_cheat_suspicion NUMERIC(5, 4),
  ADD COLUMN IF NOT EXISTS cheat_flagged BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS anti_cheat_analyzed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS player_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_address VARCHAR(255) NOT NULL,
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  anomaly_score NUMERIC(5, 4) NOT NULL CHECK (anomaly_score BETWEEN 0 AND 1),
  reasons JSONB NOT NULL DEFAULT '[]',
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'reviewed', 'dismissed', 'confirmed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  UNIQUE (game_id, player_address)
);

CREATE INDEX IF NOT EXISTS idx_player_flags_review_queue
  ON player_flags(status, anomaly_score DESC, created_at);
CREATE INDEX IF NOT EXISTS idx_match_audit_move_timestamps
  ON match_audit_logs(game_id, move_timestamp_ms)
  WHERE event_type = 'move.submitted';

-- DOWN
DROP INDEX IF EXISTS idx_match_audit_move_timestamps;
DROP INDEX IF EXISTS idx_player_flags_review_queue;
DROP TABLE IF EXISTS player_flags;
ALTER TABLE games
  DROP COLUMN IF EXISTS anti_cheat_analyzed_at,
  DROP COLUMN IF EXISTS cheat_flagged,
  DROP COLUMN IF EXISTS black_cheat_suspicion,
  DROP COLUMN IF EXISTS white_cheat_suspicion;
ALTER TABLE match_audit_logs
  DROP COLUMN IF EXISTS centipawn_loss,
  DROP COLUMN IF EXISTS engine_top_move,
  DROP COLUMN IF EXISTS move_duration_ms,
  DROP COLUMN IF EXISTS move_timestamp_ms;
