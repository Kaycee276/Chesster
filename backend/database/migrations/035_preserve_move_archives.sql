-- Retain compact move history in the existing game row; never remove games.
ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS pgn TEXT,
  ADD COLUMN IF NOT EXISTS move_archive TEXT,
  ADD COLUMN IF NOT EXISTS moves_archived_at TIMESTAMPTZ;

COMMENT ON COLUMN public.games.move_archive IS 'Versioned gzip/base64 complete move rows for archived game replay';

-- DOWN
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.games WHERE moves_archived_at IS NOT NULL OR move_archive IS NOT NULL OR pgn IS NOT NULL) THEN
    RAISE EXCEPTION 'Restore archived move rows before removing move-archive columns';
  END IF;
END $$;
ALTER TABLE public.games
  DROP COLUMN IF EXISTS moves_archived_at,
  DROP COLUMN IF EXISTS move_archive,
  DROP COLUMN IF EXISTS pgn;
