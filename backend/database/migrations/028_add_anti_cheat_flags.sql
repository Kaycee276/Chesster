-- Migration: 028_add_anti_cheat_flags.sql
-- Description: Persist move time variance entropy telemetry flags (Issue #461).
-- Each element is { type, timeVarianceEntropyScore, threshold, color,
-- playerAddress[, engineCorrelation] } written by the anti-cheat analysis.

-- UP
ALTER TABLE games
  ADD COLUMN IF NOT EXISTS anti_cheat_flags JSONB NOT NULL DEFAULT '[]'::jsonb;

-- DOWN
ALTER TABLE games DROP COLUMN IF EXISTS anti_cheat_flags;
