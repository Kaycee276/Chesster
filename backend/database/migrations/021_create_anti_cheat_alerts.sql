-- Persist player-level engine-pattern alerts for administrative review.
CREATE TABLE IF NOT EXISTS anti_cheat_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_address VARCHAR(255) NOT NULL,
  suspicion_score INTEGER NOT NULL CHECK (suspicion_score BETWEEN 0 AND 100),
  reasons JSONB NOT NULL DEFAULT '[]',
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'reviewed', 'dismissed', 'confirmed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (game_id, player_address)
);

CREATE INDEX IF NOT EXISTS idx_anti_cheat_alerts_review_queue
  ON anti_cheat_alerts(status, suspicion_score DESC, created_at);

-- DOWN
DROP INDEX IF EXISTS idx_anti_cheat_alerts_review_queue;
DROP TABLE IF EXISTS anti_cheat_alerts;
