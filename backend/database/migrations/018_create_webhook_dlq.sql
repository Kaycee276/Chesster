-- Migration 018: Dead-letter queue for webhook deliveries (feat #246)
-- Webhooks that still fail after every retry attempt in webhookService are
-- archived here so an administrator can inspect them and replay them later
-- via WebhookService#replayDeadLetterWebhook(id).
--
-- status lifecycle:
--   pending   -> delivery exhausted its retries; awaiting manual replay
--   replaying -> an administrator replay is in flight (acts as a row lock)
--   replayed  -> a manual replay succeeded; kept for audit purposes

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS webhook_dead_letter_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url TEXT NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  attempts INTEGER NOT NULL CHECK (attempts >= 1),
  last_error TEXT,
  last_status_code INTEGER,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'replaying', 'replayed')),
  replay_count INTEGER NOT NULL DEFAULT 0 CHECK (replay_count >= 0),
  last_replayed_at TIMESTAMPTZ,
  replayed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_dlq_status_created
  ON webhook_dead_letter_queue(status, created_at);
CREATE INDEX IF NOT EXISTS idx_webhook_dlq_event_type
  ON webhook_dead_letter_queue(event_type);

-- Row Level Security: payloads and partner endpoints are internal data, so
-- only the backend (service role) may read or write this table.
ALTER TABLE webhook_dead_letter_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS webhook_dlq_service_role_policy ON webhook_dead_letter_queue;
CREATE POLICY webhook_dlq_service_role_policy ON webhook_dead_letter_queue
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- DOWN
DROP TABLE IF EXISTS webhook_dead_letter_queue;
