-- Migration: 012_partition_games_table.sql
-- Domain: Database | Partition the `games` table by month on `created_at`.
--
-- Goal: improve query performance and manageability on large historical
-- datasets by range-partitioning `games` into monthly partitions.
--
-- Design notes / trade-offs (required by PostgreSQL partitioning rules):
--   * A partitioned table's PRIMARY KEY and every UNIQUE constraint MUST
--     include the partition key. The PK therefore becomes (id, created_at).
--   * `game_code` was previously globally UNIQUE. On a partitioned table that
--     unique constraint must include the partition key, so uniqueness now
--     spans (game_code, created_at). Global uniqueness of `game_code` alone is
--     relaxed; enforce it at the application layer if required.
--   * Child tables (`moves`, `match_audit_logs`, ...) referenced `games(id)`
--     via foreign keys. A single-column FK cannot target a partitioned primary
--     key, so those FKs are dropped. The referencing columns are retained and
--     referential integrity is enforced at the application layer.
--
-- Idempotent: safe to re-run. It converts `games` only when it is not already
-- partitioned, and it recovers from a partially-completed previous run.

DO $$
DECLARE
  v_is_partitioned boolean;
  v_games_exists    boolean;
  v_min             timestamptz;
  v_max             timestamptz;
  v_start           date;
  v_end             date;
  v_from            timestamptz;
  v_to              timestamptz;
  v_part_name       text;
  v_i               int := 0;
  fk_rec            record;
BEGIN
  -- 1. Already partitioned? Nothing to do.
  SELECT EXISTS (
    SELECT 1
    FROM pg_partitioned_table p
    JOIN pg_class c ON c.oid = p.partrelid
    WHERE c.relname = 'games'
  ) INTO v_is_partitioned;

  IF v_is_partitioned THEN
    RAISE NOTICE 'games is already partitioned; migration 012 skipped.';
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'games' AND relkind = 'r'
  ) INTO v_games_exists;

  -- 2. Recover from a previously interrupted run.
  IF EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'games_partitioned' AND relkind = 'r'
  ) THEN
    IF v_games_exists THEN
      -- Inconsistent half-built state: discard partial work and redo from scratch.
      DROP TABLE games_partitioned;
    ELSE
      -- Data was already copied; just finalize the rename.
      ALTER TABLE games_partitioned RENAME TO games;
      ALTER TABLE games ENABLE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS "Allow all operations on games" ON games;
      CREATE POLICY "Allow all operations on games" ON games FOR ALL USING (true);
      RAISE NOTICE 'Recovered unfinished partition rename; migration 012 complete.';
      RETURN;
    END IF;
  END IF;

  -- 3. Build the new partitioned table with the same columns as `games`.
  CREATE TABLE games_partitioned (
    id                        UUID                     NOT NULL DEFAULT gen_random_uuid(),
    game_code                 VARCHAR(10)              NOT NULL,
    game_type                 VARCHAR(50)              DEFAULT 'chess',
    board_state               JSONB                    NOT NULL,
    current_turn              VARCHAR(10)              NOT NULL,
    status                    VARCHAR(20)              DEFAULT 'waiting',
    player_white              BOOLEAN                  DEFAULT false,
    player_black              BOOLEAN                  DEFAULT false,
    move_count                INTEGER                  DEFAULT 0,
    winner                    VARCHAR(10),
    created_at                TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    turn_started_at           TIMESTAMP WITH TIME ZONE,
    player_white_address      VARCHAR(255),
    player_black_address      VARCHAR(255),
    wager_amount              NUMERIC,
    token_address             VARCHAR(255),
    escrow_status             JSONB,
    escrow_create_tx          TEXT,
    escrow_join_tx            TEXT,
    escrow_resolve_tx         TEXT,
    time_control_seconds      INTEGER                  DEFAULT 600,
    last_move                 JSONB,
    in_check                  BOOLEAN                  DEFAULT false,
    draw_offer                VARCHAR(10),
    captured_white            JSONB                    DEFAULT '[]',
    captured_black            JSONB                    DEFAULT '[]',
    game_started_at           TIMESTAMP WITH TIME ZONE,
    time_control_preset       VARCHAR(20),
    time_increment_seconds    INTEGER                  DEFAULT 0,
    undo_request              VARCHAR(10),
    undo_request_at           TIMESTAMP WITH TIME ZONE
  ) PARTITION BY RANGE (created_at);

  -- 4. Constraints (must include the partition key).
  ALTER TABLE games_partitioned ADD PRIMARY KEY (id, created_at);
  ALTER TABLE games_partitioned
    ADD CONSTRAINT uq_games_game_code_created_at UNIQUE (game_code, created_at);

  -- 5. Explicit indexes for query performance.
  CREATE INDEX idx_games_code          ON games_partitioned (game_code, created_at);
  CREATE INDEX idx_games_created_at    ON games_partitioned (created_at);
  CREATE INDEX idx_games_status_created ON games_partitioned (status, created_at);

  -- 6. Monthly partitions covering existing data plus ~12 months of future,
  --    and a DEFAULT partition to catch anything outside the generated range.
  IF v_games_exists THEN
    SELECT min(created_at), max(created_at) INTO v_min, v_max FROM games;
  END IF;

  v_start := date_trunc('month', COALESCE(v_min, now()));
  v_end   := greatest(
    date_trunc('month', now()),
    date_trunc('month', COALESCE(v_max, now()))
  ) + interval '12 months';

  LOOP
    v_from := v_start + (v_i || ' months')::interval;
    v_to   := v_from + interval '1 month';
    v_part_name := 'games_part_' || to_char(v_from, 'YYYY_MM');
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF games_partitioned FOR VALUES FROM (%L) TO (%L)',
      v_part_name, v_from, v_to
    );
    EXIT WHEN v_from >= v_end;
    v_i := v_i + 1;
  END LOOP;

  EXECUTE 'CREATE TABLE IF NOT EXISTS games_part_default PARTITION OF games_partitioned DEFAULT';

  -- 7. If an original (non-partitioned) `games` table exists, migrate its data.
  IF v_games_exists THEN
    -- Drop every foreign key that references `games(id)` (e.g. on `moves`,
    -- `match_audit_logs`). A single-column FK cannot target a partitioned PK.
    FOR fk_rec IN
      SELECT conname, conrelid::regclass AS referenced_table
      FROM pg_constraint
      WHERE contype = 'f'
        AND confrelid = 'games'::regclass
    LOOP
      EXECUTE format(
        'ALTER TABLE %I DROP CONSTRAINT %I',
        fk_rec.referenced_table, fk_rec.conname
      );
    END LOOP;

    INSERT INTO games_partitioned (
      id, game_code, game_type, board_state, current_turn, status,
      player_white, player_black, move_count, winner, created_at, updated_at,
      turn_started_at, player_white_address, player_black_address, wager_amount,
      token_address, escrow_status, in_check, last_move, draw_offer,
      captured_white, captured_black, time_control_seconds, escrow_create_tx,
      escrow_join_tx, escrow_resolve_tx, game_started_at, time_control_preset,
      time_increment_seconds, undo_request, undo_request_at
    )
    SELECT
      id, game_code, game_type, board_state, current_turn, status,
      player_white, player_black, move_count, winner, COALESCE(created_at, now()), updated_at,
      turn_started_at, player_white_address, player_black_address, wager_amount,
      token_address, escrow_status, in_check, last_move, draw_offer,
      captured_white, captured_black, time_control_seconds, escrow_create_tx,
      escrow_join_tx, escrow_resolve_tx, game_started_at, time_control_preset,
      time_increment_seconds, undo_request, undo_request_at
    FROM games;

    DROP TABLE games;
  END IF;

  -- 8. Promote the partitioned table to the canonical `games` name.
  ALTER TABLE games_partitioned RENAME TO games;

  -- 9. Recreate Row Level Security + policy (dropped with the old table).
  ALTER TABLE games ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "Allow all operations on games" ON games;
  CREATE POLICY "Allow all operations on games" ON games FOR ALL USING (true);

  RAISE NOTICE 'games table successfully partitioned by month on created_at.';
END $$;

-- ---------------------------------------------------------------------------
-- Rollback (manual): to revert this migration, drop the partitioned `games`
-- table and recreate the original non-partitioned table via schema.sql, then
-- re-apply the foreign key on `moves` (game_id -> games(id) ON DELETE CASCADE).
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Verification helpers (run against a local PostgreSQL instance):
--   * Confirm partitioning:
--       SELECT inhrelid::regclass FROM pg_inherits
--        WHERE inhparent = 'games'::regclass ORDER BY inhrelid;
--   * Confirm partition pruning with EXPLAIN ANALYZE:
--       EXPLAIN ANALYZE SELECT * FROM games
--        WHERE created_at >= '2026-01-01' AND created_at < '2026-02-01';
--     Only the matching monthly partition should be scanned.
--   * Index usage:
--       EXPLAIN ANALYZE SELECT * FROM games WHERE game_code = 'ABC123';
-- ---------------------------------------------------------------------------
