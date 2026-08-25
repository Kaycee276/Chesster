-- Migration 005: Add soft delete and game archival partitioning
-- Purpose: Filter abandoned match lobbies from active query scans
-- Target tables: games, chat_messages
-- Idempotent: All statements use IF NOT EXISTS / IF EXISTS guards

-- ============================================================
-- UP
-- ============================================================

-- Add soft-delete timestamp to games
ALTER TABLE games
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;

-- Add archival status to games
--   'active'     – normal live game
--   'archived'   – completed/abandoned, eligible for partitioning
--   'pending_delete' – soft-deleted, awaiting archival batch
ALTER TABLE games
  ADD COLUMN IF NOT EXISTS archival_status VARCHAR(20) DEFAULT 'active'
    CHECK (archival_status IN ('active', 'archived', 'pending_delete'));

-- Mark abandoned lobbies: games stuck in 'waiting' with no move for >24h
-- (application layer should call this periodically or via a cron job)
-- UPDATE games
--   SET archival_status = 'pending_delete', deleted_at = NOW()
--   WHERE status = 'waiting'
--     AND move_count = 0
--     AND deleted_at IS NULL
--     AND created_at < NOW() - INTERVAL '24 hours';

-- Add soft-delete timestamp to chat_messages (tied to game lifecycle)
ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;

-- Indexes for efficient filtering of active vs archived/deleted rows

-- Composite index: active, non-deleted games by status (lobby lookups)
CREATE INDEX IF NOT EXISTS idx_games_active_status
  ON games (status, created_at)
  WHERE deleted_at IS NULL AND archival_status = 'active';

-- Index for archival batch queries
CREATE INDEX IF NOT EXISTS idx_games_archival_status
  ON games (archival_status, created_at)
  WHERE deleted_at IS NOT NULL;

-- Index for soft-deleted chat messages
CREATE INDEX IF NOT EXISTS idx_chat_deleted_at
  ON chat_messages (deleted_at)
  WHERE deleted_at IS NOT NULL;

-- ============================================================
-- DOWN  (rollback)
-- ============================================================

-- Uncomment the block below to roll back this migration.

-- DROP INDEX IF EXISTS idx_games_active_status;
-- DROP INDEX IF EXISTS idx_games_archival_status;
-- DROP INDEX IF EXISTS idx_chat_deleted_at;
-- ALTER TABLE chat_messages DROP COLUMN IF EXISTS deleted_at;
-- ALTER TABLE games DROP COLUMN IF EXISTS archival_status;
-- ALTER TABLE games DROP COLUMN IF EXISTS deleted_at;
