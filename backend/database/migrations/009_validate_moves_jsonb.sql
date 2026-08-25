-- Migration 009: Move history JSONB schema validation constraint
-- Validates that the move_history JSONB column on games contains a properly
-- structured array where every move object carries the required coordinate
-- and metadata fields.

-- ============================================================
-- UP
-- ============================================================

-- 1. Add the move_history JSONB column if it does not exist yet.
ALTER TABLE games
  ADD COLUMN IF NOT EXISTS move_history JSONB DEFAULT '[]'::jsonb;

-- 2. Helper function: validates that a single move object has all
--    required fields and that coordinate values are non-empty strings.
CREATE OR REPLACE FUNCTION validate_move_object(moves_arr jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  el   jsonb;
  i    int;
BEGIN
  -- Must be a JSON array (not null, not an object, not a scalar).
  IF jsonb_typeof(moves_arr) != 'array' THEN
    RETURN false;
  END IF;

  -- Empty array is valid (no moves yet).
  IF jsonb_array_length(moves_arr) = 0 THEN
    RETURN true;
  END IF;

  FOR i IN 0 .. jsonb_array_length(moves_arr) - 1 LOOP
    el := moves_arr -> i;

    -- Each element must be a JSON object.
    IF jsonb_typeof(el) != 'object' THEN
      RETURN false;
    END IF;

    -- Required string fields: from_sq, to_sq, piece, color
    IF el ->> 'from_sq' IS NULL
       OR length(el ->> 'from_sq') = 0 THEN
      RETURN false;
    END IF;

    IF el ->> 'to_sq' IS NULL
       OR length(el ->> 'to_sq') = 0 THEN
      RETURN false;
    END IF;

    IF el ->> 'piece' IS NULL
       OR length(el ->> 'piece') = 0 THEN
      RETURN false;
    END IF;

    IF el ->> 'color' IS NULL
       OR length(el ->> 'color') = 0 THEN
      RETURN false;
    END IF;

    -- Optional but, if present, must be a string.
    IF el ? 'notation'
       AND jsonb_typeof(el -> 'notation') != 'string' THEN
      RETURN false;
    END IF;

    IF el ? 'promotion'
       AND jsonb_typeof(el -> 'promotion') != 'string' THEN
      RETURN false;
    END IF;

    -- Optional boolean flags.
    IF el ? 'is_check'
       AND jsonb_typeof(el -> 'is_check') != 'boolean' THEN
      RETURN false;
    END IF;

    IF el ? 'is_checkmate'
       AND jsonb_typeof(el -> 'is_checkmate') != 'boolean' THEN
      RETURN false;
    END IF;
  END LOOP;

  RETURN true;
END;
$$;

-- 3. Attach the CHECK constraint to the column.
--    IF NOT EXISTS is not supported for constraints, so we guard with
--    a DO block that only adds the constraint when it is missing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_move_history_valid'
      AND conrelid = 'games'::regclass
  ) THEN
    ALTER TABLE games
      ADD CONSTRAINT chk_move_history_valid
      CHECK (validate_move_object(move_history));
  END IF;
END
$$;

-- ============================================================
-- DOWN / Rollback  (uncomment and run to reverse this migration)
-- ============================================================
-- ALTER TABLE games DROP CONSTRAINT IF EXISTS chk_move_history_valid;
-- DROP FUNCTION IF EXISTS validate_move_object(jsonb);
-- ALTER TABLE games DROP COLUMN IF EXISTS move_history;
