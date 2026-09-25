-- Tournament schedule and notification delivery state.

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS prize_pool NUMERIC(30, 7) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reminder_15m_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reminder_5m_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS winner_announced_at TIMESTAMPTZ;

ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;

CREATE INDEX IF NOT EXISTS idx_tournaments_upcoming_notifications
  ON tournaments(starts_at)
  WHERE status IN ('draft', 'open') AND starts_at IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email
  ON users(LOWER(email))
  WHERE email IS NOT NULL;

-- DOWN
DROP INDEX IF EXISTS idx_users_email;
DROP INDEX IF EXISTS idx_tournaments_upcoming_notifications;
ALTER TABLE users DROP COLUMN IF EXISTS email;
ALTER TABLE tournaments
  DROP COLUMN IF EXISTS winner_announced_at,
  DROP COLUMN IF EXISTS reminder_5m_sent_at,
  DROP COLUMN IF EXISTS reminder_15m_sent_at,
  DROP COLUMN IF EXISTS prize_pool,
  DROP COLUMN IF EXISTS starts_at;
