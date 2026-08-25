-- Migration: Player match statistics aggregation trigger (feat #76)
-- Automatically updates player win/loss/draw totals when a match is completed.

-- ============================================================
-- UP
-- ============================================================

-- 1. Create the player_stats table (if it doesn't exist)
CREATE TABLE IF NOT EXISTS player_stats (
  wallet_address VARCHAR(255) PRIMARY KEY,
  wins          INTEGER NOT NULL DEFAULT 0,
  losses        INTEGER NOT NULL DEFAULT 0,
  draws         INTEGER NOT NULL DEFAULT 0,
  games_played  INTEGER NOT NULL DEFAULT 0,
  updated_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Indexes for common lookups
CREATE INDEX IF NOT EXISTS idx_player_stats_wins ON player_stats(wins DESC);
CREATE INDEX IF NOT EXISTS idx_player_stats_games_played ON player_stats(games_played DESC);

-- 3. Row-level security
ALTER TABLE player_stats ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Allow all operations on player_stats'
  ) THEN
    CREATE POLICY "Allow all operations on player_stats" ON player_stats FOR ALL USING (true);
  END IF;
END $$;

-- 4. Trigger function: upsert aggregated stats on every finished-game write
CREATE OR REPLACE FUNCTION fn_update_player_stats()
RETURNS TRIGGER AS $$
DECLARE
  white_addr TEXT;
  black_addr TEXT;
  game_winner TEXT;
BEGIN
  -- Only act when the game just transitioned to finished
  IF NEW.status <> 'finished' THEN
    RETURN NEW;
  END IF;

  -- Avoid double-counting: skip if stats were already recorded for this game
  -- (check is done via a lightweight sentinel – updated_at within the same second
  --  is effectively unique enough for dedup in a trigger context).
  IF OLD.status = 'finished' THEN
    RETURN NEW;
  END IF;

  white_addr := NEW.player_white_address;
  black_addr := NEW.player_black_address;
  game_winner := NEW.winner; -- 'white', 'black', or 'draw'

  -- White player
  IF white_addr IS NOT NULL THEN
    INSERT INTO player_stats (wallet_address, games_played, wins, losses, draws, updated_at)
    VALUES (
      white_addr,
      1,
      CASE WHEN game_winner = 'white' THEN 1 ELSE 0 END,
      CASE WHEN game_winner = 'black' THEN 1 ELSE 0 END,
      CASE WHEN game_winner = 'draw'  THEN 1 ELSE 0 END,
      NOW()
    )
    ON CONFLICT (wallet_address) DO UPDATE SET
      games_played = player_stats.games_played + 1,
      wins          = player_stats.wins          + CASE WHEN game_winner = 'white' THEN 1 ELSE 0 END,
      losses        = player_stats.losses        + CASE WHEN game_winner = 'black' THEN 1 ELSE 0 END,
      draws         = player_stats.draws         + CASE WHEN game_winner = 'draw'  THEN 1 ELSE 0 END,
      updated_at    = NOW();
  END IF;

  -- Black player
  IF black_addr IS NOT NULL THEN
    INSERT INTO player_stats (wallet_address, games_played, wins, losses, draws, updated_at)
    VALUES (
      black_addr,
      1,
      CASE WHEN game_winner = 'black' THEN 1 ELSE 0 END,
      CASE WHEN game_winner = 'white' THEN 1 ELSE 0 END,
      CASE WHEN game_winner = 'draw'  THEN 1 ELSE 0 END,
      NOW()
    )
    ON CONFLICT (wallet_address) DO UPDATE SET
      games_played = player_stats.games_played + 1,
      wins          = player_stats.wins          + CASE WHEN game_winner = 'black' THEN 1 ELSE 0 END,
      losses        = player_stats.losses        + CASE WHEN game_winner = 'white' THEN 1 ELSE 0 END,
      draws         = player_stats.draws         + CASE WHEN game_winner = 'draw'  THEN 1 ELSE 0 END,
      updated_at    = NOW();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5. Attach the trigger to the games table
DROP TRIGGER IF EXISTS trg_update_player_stats ON games;
CREATE TRIGGER trg_update_player_stats
  AFTER UPDATE OF status ON games
  FOR EACH ROW
  EXECUTE FUNCTION fn_update_player_stats();

-- Also fire on INSERT for games that are created already-finished (edge case)
DROP TRIGGER IF EXISTS trg_update_player_stats_insert ON games;
CREATE TRIGGER trg_update_player_stats_insert
  AFTER INSERT ON games
  FOR EACH ROW
  WHEN (NEW.status = 'finished')
  EXECUTE FUNCTION fn_update_player_stats();

-- ============================================================
-- DOWN / Rollback
-- ============================================================
-- DROP TRIGGER IF EXISTS trg_update_player_stats_insert ON games;
-- DROP TRIGGER IF EXISTS trg_update_player_stats ON games;
-- DROP FUNCTION IF EXISTS fn_update_player_stats();
-- DROP TABLE IF EXISTS player_stats;
