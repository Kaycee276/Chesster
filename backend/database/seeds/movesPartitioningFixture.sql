-- Disposable integration-test seed: legacy columns, metadata and month edges.
CREATE TABLE public.games (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
INSERT INTO public.games (id) VALUES ('00000000-0000-0000-0000-000000000001');
CREATE TABLE public.moves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID REFERENCES public.games(id) ON DELETE CASCADE,
  move_number INTEGER NOT NULL,
  player VARCHAR(10) NOT NULL,
  from_position JSONB NOT NULL,
  to_position JSONB NOT NULL,
  piece VARCHAR(5) NOT NULL,
  board_state_after JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  is_check BOOLEAN DEFAULT false,
  is_checkmate BOOLEAN DEFAULT false,
  promotion VARCHAR(5),
  evaluation_cp INTEGER
);
CREATE INDEX idx_moves_game ON public.moves (game_id, move_number);
CREATE INDEX idx_moves_game_id_created_at ON public.moves (game_id, created_at);
ALTER TABLE public.moves ENABLE ROW LEVEL SECURITY;
CREATE POLICY moves_select_policy ON public.moves FOR SELECT USING (true);
CREATE POLICY moves_insert_policy ON public.moves FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.games g WHERE g.id = moves.game_id)
);
GRANT SELECT ON public.moves TO PUBLIC;
INSERT INTO public.moves (game_id, move_number, player, from_position, to_position, piece, board_state_after, created_at, evaluation_cp)
SELECT '00000000-0000-0000-0000-000000000001', n, 'white', '[6,4]', '[4,4]', 'P', '[]', ts, 42
FROM (VALUES
  (1, '2025-11-30 23:59:59.999999+00'::timestamptz),
  (2, '2025-12-01 00:00:00+00'::timestamptz),
  (3, NULL::timestamptz)
) fixture(n, ts);
