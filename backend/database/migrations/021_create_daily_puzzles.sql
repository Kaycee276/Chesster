CREATE TABLE IF NOT EXISTS puzzles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fen TEXT NOT NULL,
  side_to_move VARCHAR(5) NOT NULL CHECK (side_to_move IN ('white', 'black')),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 400 AND 3500),
  solution_moves TEXT[] NOT NULL CHECK (cardinality(solution_moves) > 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_puzzles_active_id ON puzzles (id) WHERE is_active = TRUE;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS puzzle_rating INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS experience_points INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS puzzle_solve_streak INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_puzzle_solved_on DATE;

CREATE TABLE IF NOT EXISTS puzzle_solves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  puzzle_id UUID NOT NULL REFERENCES puzzles(id) ON DELETE CASCADE,
  solved_on DATE NOT NULL,
  points_awarded INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, puzzle_id)
);

CREATE INDEX IF NOT EXISTS idx_puzzle_solves_user_date
  ON puzzle_solves (user_id, solved_on DESC);

CREATE OR REPLACE FUNCTION record_puzzle_solve(
  p_wallet_address TEXT,
  p_puzzle_id UUID,
  p_solved_on DATE,
  p_points INTEGER DEFAULT 10
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  player users%ROWTYPE;
  solve_id UUID;
  next_streak INTEGER;
BEGIN
  SELECT * INTO player
  FROM users
  WHERE wallet_address = p_wallet_address
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  INSERT INTO puzzle_solves (user_id, puzzle_id, solved_on, points_awarded)
  VALUES (player.id, p_puzzle_id, p_solved_on, p_points)
  ON CONFLICT (user_id, puzzle_id) DO NOTHING
  RETURNING id INTO solve_id;

  IF solve_id IS NULL THEN
    RETURN jsonb_build_object(
      'awarded', FALSE,
      'points', 0,
      'puzzleRating', player.puzzle_rating,
      'experiencePoints', player.experience_points,
      'streak', player.puzzle_solve_streak
    );
  END IF;

  next_streak := CASE
    WHEN player.last_puzzle_solved_on = p_solved_on - 1 THEN player.puzzle_solve_streak + 1
    WHEN player.last_puzzle_solved_on = p_solved_on THEN player.puzzle_solve_streak
    ELSE 1
  END;

  UPDATE users
  SET puzzle_rating = puzzle_rating + p_points,
      experience_points = experience_points + p_points,
      puzzle_solve_streak = next_streak,
      last_puzzle_solved_on = p_solved_on,
      updated_at = NOW()
  WHERE id = player.id
  RETURNING * INTO player;

  RETURN jsonb_build_object(
    'awarded', TRUE,
    'points', p_points,
    'puzzleRating', player.puzzle_rating,
    'experiencePoints', player.experience_points,
    'streak', player.puzzle_solve_streak
  );
END;
$$;

INSERT INTO puzzles (id, fen, side_to_move, rating, solution_moves)
VALUES
  ('11111111-1111-4111-8111-111111111111', '6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1', 'white', 900, ARRAY['e1e8']),
  ('22222222-2222-4222-8222-222222222222', '4r1k1/5ppp/8/8/8/8/5PPP/6K1 b - - 0 1', 'black', 1100, ARRAY['e8e1']),
  ('33333333-3333-4333-8333-333333333333', '6k1/8/8/8/3q4/8/5PPP/6K1 b - - 0 1', 'black', 1300, ARRAY['d4d1'])
ON CONFLICT (id) DO NOTHING;

-- DOWN
DROP FUNCTION IF EXISTS record_puzzle_solve(TEXT, UUID, DATE, INTEGER);
DROP TABLE IF EXISTS puzzle_solves;
DROP TABLE IF EXISTS puzzles;
ALTER TABLE users
  DROP COLUMN IF EXISTS last_puzzle_solved_on,
  DROP COLUMN IF EXISTS puzzle_solve_streak,
  DROP COLUMN IF EXISTS experience_points,
  DROP COLUMN IF EXISTS puzzle_rating;
