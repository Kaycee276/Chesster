-- Repair installations where another migration with version 017 caused the
-- migration runner to skip 017_add_composite_game_indexes.sql. Keep this full
-- composite index consistent with the Game model in prisma/schema.prisma.
-- The migration runner wraps this statement in a transaction.

CREATE INDEX IF NOT EXISTS "idx_games_status_created_at"
  ON "games" ("status", "created_at" DESC);

-- DOWN
-- Preserve the index on rollback: it is also owned by migration 017 and Prisma.
