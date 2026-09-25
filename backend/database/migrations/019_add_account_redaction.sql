-- GDPR/CCPA account redaction. The function executes atomically and keeps
-- games and moves intact so opponents retain complete match histories.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS bio VARCHAR(280),
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION anonymize_user_data(p_wallet_address TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected_users INTEGER := 0;
  deleted_chats INTEGER := 0;
  deleted_audits INTEGER := 0;
  preserved_games INTEGER := 0;
BEGIN
  UPDATE users
  SET username = 'Anonymous Player [Deleted]',
      email = NULL,
      avatar_url = NULL,
      bio = NULL,
      country = NULL,
      is_deleted = TRUE,
      deleted_at = NOW(),
      updated_at = NOW()
  WHERE wallet_address = p_wallet_address;
  GET DIAGNOSTICS affected_users = ROW_COUNT;

  IF affected_users = 0 THEN
    RETURN NULL;
  END IF;

  UPDATE players
  SET username = 'Anonymous Player [Deleted]',
      email = NULL,
      avatar_url = NULL,
      bio = NULL,
      is_deleted = TRUE,
      deleted_at = NOW()
  WHERE wallet_address = p_wallet_address;

  DELETE FROM chat_messages AS message
  USING games AS game
  WHERE message.game_code = game.game_code
    AND (
      (message.player_color = 'white' AND game.player_white_address = p_wallet_address)
      OR
      (message.player_color = 'black' AND game.player_black_address = p_wallet_address)
    );
  GET DIAGNOSTICS deleted_chats = ROW_COUNT;

  DELETE FROM match_audit_logs
  WHERE player_address = p_wallet_address
     OR event_data ->> 'sender_wallet' = p_wallet_address;
  GET DIAGNOSTICS deleted_audits = ROW_COUNT;

  SELECT COUNT(*) INTO preserved_games
  FROM games
  WHERE player_white_address = p_wallet_address
     OR player_black_address = p_wallet_address;

  RETURN jsonb_build_object(
    'deletedChatMessages', deleted_chats,
    'deletedAuditLogs', deleted_audits,
    'preservedGames', preserved_games
  );
END;
$$;

-- DOWN
DROP FUNCTION IF EXISTS anonymize_user_data(TEXT);
ALTER TABLE players
  DROP COLUMN IF EXISTS deleted_at,
  DROP COLUMN IF EXISTS is_deleted,
  DROP COLUMN IF EXISTS bio,
  DROP COLUMN IF EXISTS avatar_url,
  DROP COLUMN IF EXISTS email;
ALTER TABLE users
  DROP COLUMN IF EXISTS deleted_at,
  DROP COLUMN IF EXISTS is_deleted,
  DROP COLUMN IF EXISTS email;
