ALTER TABLE games ADD COLUMN IF NOT EXISTS variant VARCHAR(20) NOT NULL DEFAULT 'standard';
UPDATE games SET variant = CASE WHEN game_type IN ('blindfold', 'fog_of_war') THEN game_type ELSE 'standard' END;
ALTER TABLE games DROP CONSTRAINT IF EXISTS games_variant_check;
ALTER TABLE games ADD CONSTRAINT games_variant_check CHECK (variant IN ('standard', 'blindfold', 'fog_of_war'));
CREATE INDEX IF NOT EXISTS idx_games_variant ON games (variant);
