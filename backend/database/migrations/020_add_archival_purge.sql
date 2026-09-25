-- Purge an uploaded archive batch atomically. Deleting games cascades to
-- moves and match_audit_logs; chat uses game_code and is removed explicitly.
CREATE OR REPLACE FUNCTION purge_archived_games(p_game_ids UUID[])
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  purged_count INTEGER := 0;
BEGIN
  IF COALESCE(cardinality(p_game_ids), 0) = 0 THEN
    RETURN 0;
  END IF;

  -- Lock every requested row and abort the transaction if any row is absent
  -- or no longer eligible for archival.
  PERFORM id
  FROM games
  WHERE id = ANY(p_game_ids)
    AND status IN ('finished', 'completed')
  FOR UPDATE;

  IF (SELECT COUNT(*) FROM games
      WHERE id = ANY(p_game_ids)
        AND status IN ('finished', 'completed')) <> cardinality(p_game_ids) THEN
    RAISE EXCEPTION 'archival batch changed before purge';
  END IF;

  DELETE FROM chat_messages
  WHERE game_code IN (
    SELECT game_code FROM games WHERE id = ANY(p_game_ids)
  );

  DELETE FROM games
  WHERE id = ANY(p_game_ids)
    AND status IN ('finished', 'completed');
  GET DIAGNOSTICS purged_count = ROW_COUNT;

  IF purged_count <> cardinality(p_game_ids) THEN
    RAISE EXCEPTION 'archival purge removed % of % games', purged_count, cardinality(p_game_ids);
  END IF;

  RETURN purged_count;
END;
$$;

-- DOWN
DROP FUNCTION IF EXISTS purge_archived_games(UUID[]);
