-- Migration: Add position_history, halfmove_clock and draw claim tracking columns to games table
-- Supports automated threefold/fivefold repetition and 50/75-move rule draw detection.
ALTER TABLE games ADD COLUMN IF NOT EXISTS position_history JSONB DEFAULT '[]'::jsonb;
ALTER TABLE games ADD COLUMN IF NOT EXISTS halfmove_clock INTEGER DEFAULT 0;
ALTER TABLE games ADD COLUMN IF NOT EXISTS draw_claimable BOOLEAN DEFAULT false;
ALTER TABLE games ADD COLUMN IF NOT EXISTS draw_claim_reason VARCHAR(30);

-- DOWN
ALTER TABLE games DROP COLUMN IF EXISTS position_history;
ALTER TABLE games DROP COLUMN IF EXISTS halfmove_clock;
ALTER TABLE games DROP COLUMN IF EXISTS draw_claimable;
ALTER TABLE games DROP COLUMN IF EXISTS draw_claim_reason;
