-- Migration: Add time_control_preset, time_increment_seconds, and undo_request columns to games table
ALTER TABLE games ADD COLUMN IF NOT EXISTS time_control_preset VARCHAR(20);
ALTER TABLE games ADD COLUMN IF NOT EXISTS time_increment_seconds INTEGER DEFAULT 0;
ALTER TABLE games ADD COLUMN IF NOT EXISTS undo_request VARCHAR(10);
ALTER TABLE games ADD COLUMN IF NOT EXISTS undo_request_at TIMESTAMP WITH TIME ZONE;

-- DOWN
ALTER TABLE games DROP COLUMN IF EXISTS time_control_preset;
ALTER TABLE games DROP COLUMN IF EXISTS time_increment_seconds;
ALTER TABLE games DROP COLUMN IF EXISTS undo_request;
ALTER TABLE games DROP COLUMN IF EXISTS undo_request_at;
