-- Migration: 021_create_puzzles_table.sql
-- Description: Create chess_puzzles table and index for tactical category filtering (Issue #321)

-- UP
CREATE TABLE IF NOT EXISTS chess_puzzles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fen TEXT NOT NULL UNIQUE,
    solution_moves TEXT NOT NULL, -- e.g. "e2e4 e7e5 g1f3"
    rating INT NOT NULL DEFAULT 1500,
    rating_deviation INT DEFAULT 50,
    theme_tags TEXT[] DEFAULT '{}',
    times_solved INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chess_puzzles_rating_theme ON chess_puzzles (rating, theme_tags);

-- DOWN
DROP INDEX IF EXISTS idx_chess_puzzles_rating_theme;
DROP TABLE IF EXISTS chess_puzzles;