-- Migration: 032_create_anti_cheat_logs.sql
-- Description: Telemetry for move timing burst and forged premove attempts (Issue #583).

-- UP
CREATE TABLE IF NOT EXISTS anti_cheat_logs (
  id BIGSERIAL PRIMARY KEY,
  game_code VARCHAR(32) NOT NULL,
  wallet_address VARCHAR(255),
  ip_address VARCHAR(64),
  delta_ms INTEGER,
  reason VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_anti_cheat_logs_wallet_created
  ON anti_cheat_logs(wallet_address, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_anti_cheat_logs_game_code
  ON anti_cheat_logs(game_code);

-- DOWN
DROP INDEX IF EXISTS idx_anti_cheat_logs_game_code;
DROP INDEX IF EXISTS idx_anti_cheat_logs_wallet_created;
DROP TABLE IF EXISTS anti_cheat_logs;
