-- Migration: 024_add_lobby_refund_columns.sql
-- Description: Adds escrow_refund_status and escrow_refund_tx to the games table so that
--   CronService.cleanupAbandonedLobbies can durably track Soroban refund attempts for
--   waiting lobbies that expire before a second player joins.
--
-- Lifecycle (waiting wagered lobby only):
--   NULL          → not applicable (unwagered) or not yet attempted
--   'none'        → wagered lobby claimed as expired; refund not yet attempted
--   'pending'     → refund call in-flight (set before network call for crash-safety)
--   'succeeded'   → on-chain refund_after_timeout confirmed; escrow_refund_tx holds the hash
--   'failed'      → transient or terminal failure; eligible for retry on next cron tick
--
-- Idempotency: cleanupAbandonedLobbies will only attempt a refund when
--   escrow_refund_status IN ('none', 'failed'), so a succeeded row cannot be refunded twice.
--   The 'pending' guard prevents a crashed cron from restarting the same refund concurrently
--   (though a pending row that never resolves will be retried after the next restart).

-- UP
ALTER TABLE games
    ADD COLUMN IF NOT EXISTS escrow_refund_status VARCHAR(16)
        CHECK (escrow_refund_status IN ('none', 'pending', 'succeeded', 'failed')),
    ADD COLUMN IF NOT EXISTS escrow_refund_tx TEXT;

-- Partial index: only rows that need a refund attempt are indexed; keeps it tiny.
CREATE INDEX IF NOT EXISTS idx_games_lobby_refund_needed
    ON games (created_at)
    WHERE status = 'expired'
      AND escrow_status = 'pending'
      AND escrow_refund_status IN ('none', 'failed');

-- DOWN
DROP INDEX IF EXISTS idx_games_lobby_refund_needed;
ALTER TABLE games
    DROP COLUMN IF EXISTS escrow_refund_tx,
    DROP COLUMN IF EXISTS escrow_refund_status;
