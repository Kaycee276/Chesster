const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { ArchivalService } = require("../services/archivalService");
const { restoreArchivedMoves } = require("../services/moveArchive");
const replayService = require("../services/replayService");
const chessEngine = require("../services/chessEngine");

// Only the dedicated disposable PostgreSQL service in moves-partitioning.yml.
const databaseUrl = process.env.MOVE_ARCHIVE_TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const migration = fs.readFileSync(path.join(__dirname, "../database/migrations/035_preserve_move_archives.sql"), "utf8");
const [up, down] = migration.split(/--\s*DOWN/);

integration("partitioned PostgreSQL move retention", () => {
  let pool;
  let service;
  const oldId = "00000000-0000-0000-0000-000000000001";
  const activeId = "00000000-0000-0000-0000-000000000002";
  const recentId = "00000000-0000-0000-0000-000000000003";
  const now = new Date("2026-11-22T12:00:00Z");
  const afterWhite = chessEngine.makeMove(chessEngine.initBoard(), [6, 4], [4, 4]);
  const finalBoard = chessEngine.makeMove(afterWhite, [1, 4], [3, 4]);

  async function insertGame(id, status, endedAt) {
    await pool.query(`INSERT INTO public.games
      (id, game_code, status, move_count, board_state, current_turn, winner, created_at, updated_at, ended_at, game_started_at, time_control_seconds)
      VALUES ($1, $2, $3, 2, $4, 'white', 'draw', $5, $5, $6, $5, 600)`,
      [id, id.slice(-6), status, JSON.stringify(finalBoard), endedAt, status === "active" ? null : endedAt]);
    for (const [index, player, from, to, board] of [
      [1, "white", [6, 4], [4, 4], afterWhite],
      [2, "black", [1, 4], [3, 4], finalBoard],
    ]) {
      await pool.query(`INSERT INTO public.moves
        (id, game_id, move_number, player, from_position, to_position, piece, board_state_after, created_at)
        VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, index, player, JSON.stringify(from), JSON.stringify(to), player === "white" ? "P" : "p", JSON.stringify(board), endedAt]);
    }
  }

  beforeAll(() => {
    pool = new Pool({ connectionString: databaseUrl });
    service = new ArchivalService({ db: { getPool: () => pool }, now: () => now });
  });
  beforeEach(async () => {
    await pool.query(`DROP TABLE IF EXISTS public.player_flags;
      DROP TABLE IF EXISTS public.moves;
      DROP TABLE IF EXISTS public.games;
      CREATE TABLE public.games (
        id uuid PRIMARY KEY, game_code text, status text, move_count integer, board_state jsonb,
        current_turn text, winner text, created_at timestamptz, updated_at timestamptz,
        ended_at timestamptz, game_started_at timestamptz, time_control_seconds integer,
        deleted_at timestamptz, cheat_flagged boolean DEFAULT false
      );
      CREATE TABLE public.player_flags (game_id uuid REFERENCES public.games(id), status text);
      CREATE TABLE public.moves (
        id uuid NOT NULL, game_id uuid REFERENCES public.games(id), move_number integer, player text,
        from_position jsonb, to_position jsonb, piece text, board_state_after jsonb,
        created_at timestamptz NOT NULL, PRIMARY KEY (id, created_at)
      ) PARTITION BY RANGE (created_at);
      CREATE TABLE public.moves_2026_06 PARTITION OF public.moves FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
      CREATE TABLE public.moves_2026_11 PARTITION OF public.moves FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');`);
    await pool.query(up);
    await insertGame(oldId, "finished", "2026-06-01T12:00:00Z");
    await insertGame(activeId, "active", "2026-06-01T12:00:00Z");
    await insertGame(recentId, "completed", "2026-11-21T12:00:00Z");
  });
  afterAll(async () => {
    if (!pool) return;
    try {
      await pool.query(`DROP TABLE IF EXISTS public.player_flags;
        DROP TABLE IF EXISTS public.moves;
        DROP TABLE IF EXISTS public.games;
        DROP FUNCTION IF EXISTS public.fail_move_archive_delete();`);
    } finally {
      await pool.end();
    }
  });

  test("dry run changes nothing; archive prunes only eligible rows and restores replay", async () => {
    const before = (await pool.query("SELECT * FROM public.moves WHERE game_id = $1 ORDER BY move_number", [oldId])).rows;
    expect(await service.archiveOldGameMoves({ batchSize: 1, dryRun: true }))
      .toMatchObject({ candidates: 1, processed: 0, movesPruned: 0 });
    expect((await pool.query("SELECT count(*)::int AS count FROM public.moves")).rows[0].count).toBe(6);
    expect(await service.archiveOldGameMoves()).toMatchObject({ processed: 1, movesPruned: 2 });
    expect((await pool.query("SELECT count(*)::int AS count FROM public.moves")).rows[0].count).toBe(4);
    const game = (await pool.query("SELECT * FROM public.games WHERE id = $1", [oldId])).rows[0];
    const restored = restoreArchivedMoves(game, []);
    expect(JSON.stringify(restored)).toBe(JSON.stringify(before));
    expect(replayService.buildReplayFrames(game, [])).toHaveLength(2);
    expect(replayService.formatPgn(game, [])).toContain("e4");
    expect(replayService.formatPgn(game, [])).toContain("e5");
    expect(await service.archiveOldGameMoves()).toMatchObject({ candidates: 0, processed: 0 });
    await expect(pool.query(down)).rejects.toThrow(/Restore archived move rows/);
    expect((await pool.query("SELECT move_archive FROM public.games WHERE id = $1", [oldId])).rows[0].move_archive).toBeTruthy();
  });

  test("a PostgreSQL delete failure rolls back both archive columns and move deletion", async () => {
    await pool.query(`CREATE OR REPLACE FUNCTION public.fail_move_archive_delete() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'forced archive delete failure'; END $$;
      CREATE TRIGGER reject_archive_delete BEFORE DELETE ON public.moves FOR EACH ROW EXECUTE FUNCTION public.fail_move_archive_delete();`);
    await expect(service.archiveOldGameMoves()).rejects.toThrow("forced archive delete failure");
    const game = (await pool.query("SELECT * FROM public.games WHERE id = $1", [oldId])).rows[0];
    expect(game.pgn).toBeNull();
    expect(game.move_archive).toBeNull();
    expect(game.moves_archived_at).toBeNull();
    expect((await pool.query("SELECT count(*)::int AS count FROM public.moves WHERE game_id = $1", [oldId])).rows[0].count).toBe(2);
  });

  test("a competing parent lock is skipped, then a later run archives it safely", async () => {
    const blocker = await pool.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM public.games WHERE id = $1 FOR UPDATE", [oldId]);
      expect(await service.archiveOldGameMoves()).toMatchObject({ candidates: 1, processed: 0, skipped: 1 });
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
    expect(await service.archiveOldGameMoves()).toMatchObject({ processed: 1, movesPruned: 2 });
  });

  test("preserves an existing valid PGN and excludes old games with pending disputes", async () => {
    const game = (await pool.query("SELECT * FROM public.games WHERE id = $1", [oldId])).rows[0];
    const moves = (await pool.query("SELECT * FROM public.moves WHERE game_id = $1 ORDER BY move_number", [oldId])).rows;
    const pgn = replayService.formatPgn({ ...game, event: "Original annotated game" }, moves);
    await pool.query("UPDATE public.games SET pgn = $2 WHERE id = $1", [oldId, pgn]);
    await pool.query("INSERT INTO public.player_flags (game_id, status) VALUES ($1, 'pending')", [oldId]);
    expect(await service.archiveOldGameMoves()).toMatchObject({ candidates: 0, processed: 0 });
    await pool.query("UPDATE public.player_flags SET status = 'resolved' WHERE game_id = $1", [oldId]);
    expect(await service.archiveOldGameMoves()).toMatchObject({ processed: 1, movesPruned: 2 });
    expect((await pool.query("SELECT pgn FROM public.games WHERE id = $1", [oldId])).rows[0].pgn).toBe(pgn);
  });
});
