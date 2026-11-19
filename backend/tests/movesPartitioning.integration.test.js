const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { ArchivalService } = require("../services/archivalService");

// This URL must point at a disposable test database: tables are reset per test.
// CI supplies a dedicated PostgreSQL 16 service through moves-partitioning.yml.
const databaseUrl = process.env.PARTITION_TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const migration = fs.readFileSync(path.join(__dirname, "../database/migrations/031_partition_moves_table.sql"), "utf8");
const fixture = fs.readFileSync(path.join(__dirname, "../database/seeds/movesPartitioningFixture.sql"), "utf8");

integration("PostgreSQL moves partition migration", () => {
  let pool;
  let service;
  async function migrate() {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(migration);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
  async function insertAt(timestamp) {
    return pool.query(`INSERT INTO public.moves (game_id, move_number, player, from_position, to_position, piece, board_state_after, created_at)
      VALUES ('00000000-0000-0000-0000-000000000001', 4, 'black', '[1,4]', '[3,4]', 'p', '[]', $1)
      RETURNING tableoid::regclass::text AS partition, id`, [timestamp]);
  }
  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    service = new ArchivalService({ db: { getPool: () => pool } });
    await pool.query("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'moves_partition_reader') THEN CREATE ROLE moves_partition_reader; END IF; END $$");
  });
  beforeEach(async () => {
    await pool.query("DROP VIEW IF EXISTS moves_test_view; DROP TABLE IF EXISTS public.moves; DROP TABLE IF EXISTS public.games");
    await pool.query(fixture);
  });
  afterAll(async () => {
    if (pool) {
      await pool.query("DROP OWNED BY moves_partition_reader; DROP ROLE moves_partition_reader");
      await pool.end();
    }
  });

  test("retains every row, extra columns, indexes, foreign keys, grants and RLS policies", async () => {
    const before = await pool.query("SELECT id, evaluation_cp FROM public.moves ORDER BY move_number");
    const policiesBefore = await pool.query("SELECT policyname, cmd, roles, qual, with_check FROM pg_policies WHERE tablename = 'moves' ORDER BY policyname");
    await migrate();
    expect((await pool.query("SELECT id, evaluation_cp FROM public.moves ORDER BY move_number")).rows).toEqual(before.rows);
    expect((await pool.query("SELECT policyname, cmd, roles, qual, with_check FROM pg_policies WHERE tablename = 'moves' ORDER BY policyname")).rows).toEqual(policiesBefore.rows);
    expect((await pool.query("SELECT count(*)::int AS count FROM public.moves WHERE created_at IS NULL")).rows[0].count).toBe(0);
    const pk = await pool.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid = 'public.moves'::regclass AND contype = 'p'");
    expect(pk.rows[0].definition).toBe("PRIMARY KEY (id, created_at)");
    const indexes = await pool.query("SELECT indexname FROM pg_indexes WHERE tablename = 'moves'");
    expect(indexes.rows.map((row) => row.indexname)).toEqual(expect.arrayContaining(["idx_moves_game", "idx_moves_game_id_created_at"]));
    const grants = await pool.query("SELECT EXISTS (SELECT 1 FROM information_schema.table_privileges WHERE table_name = 'moves' AND grantee = 'PUBLIC' AND privilege_type = 'SELECT') AS allowed");
    expect(grants.rows[0].allowed).toBe(true);
    // A non-owner exercises the copied policy's correlated game reference.
    const client = await pool.connect();
    try {
      await client.query("GRANT SELECT ON public.games TO PUBLIC; GRANT INSERT ON public.moves TO PUBLIC");
      await client.query("SET ROLE moves_partition_reader");
      const result = await client.query(`INSERT INTO public.moves (game_id, move_number, player, from_position, to_position, piece, board_state_after, created_at)
        VALUES ('00000000-0000-0000-0000-000000000001', 4, 'black', '[1,4]', '[3,4]', 'p', '[]', '2025-12-10T00:00:00Z')`);
      expect(result.rowCount).toBe(1);
    } finally {
      await client.query("RESET ROLE");
      client.release();
    }
    await pool.query("DELETE FROM public.games");
    expect((await pool.query("SELECT count(*)::int AS count FROM public.moves")).rows[0].count).toBe(0);
  });

  test("routes inserts transparently at exact UTC month boundaries and is safe to rerun", async () => {
    await migrate();
    await migrate();
    expect((await insertAt("2025-11-30T23:59:59.999999Z")).rows[0].partition).toBe("moves_2025_11");
    expect((await insertAt("2025-12-01T00:00:00Z")).rows[0].partition).toBe("moves_2025_12");
  });

  test("catches unprovisioned writes then relocates fallback rows without loss", async () => {
    await migrate();
    const row = (await insertAt("2030-01-01T00:00:00Z")).rows[0];
    expect(row.partition).toBe("moves_default");
    await service.ensureMonthlyPartitionsExist(new Date("2030-01-15T12:00:00Z"));
    await service.ensureMonthlyPartitionsExist(new Date("2030-01-31T23:59:59Z"));
    const moved = await pool.query("SELECT tableoid::regclass::text AS partition FROM public.moves WHERE id = $1", [row.id]);
    expect(moved.rows).toEqual([{ partition: "moves_2030_01" }]);
    expect((await insertAt("2030-02-01T00:00:00Z")).rows[0].partition).toBe("moves_2030_02");
  });

  test("serializes provisioning by concurrent backend instances", async () => {
    await migrate();
    const date = new Date("2031-12-01T00:00:00Z");
    const results = await Promise.all([service.ensureMonthlyPartitionsExist(date), service.ensureMonthlyPartitionsExist(date)]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0].partitions).toEqual(["moves_2031_12", "moves_2032_01", "moves_2032_02"]);
  });

  test("rolls back conversion when an unsupported dependency prevents the swap", async () => {
    await pool.query("CREATE VIEW moves_test_view AS SELECT * FROM public.moves");
    await expect(migrate()).rejects.toThrow(/depend/);
    expect((await pool.query("SELECT count(*)::int AS count FROM public.moves")).rows[0].count).toBe(3);
    expect((await pool.query("SELECT 1 FROM pg_partitioned_table WHERE partrelid = 'public.moves'::regclass")).rows).toHaveLength(0);
    expect((await pool.query("SELECT to_regclass('public.moves_partitioned') AS relation")).rows[0].relation).toBeNull();
    await pool.query("DROP VIEW moves_test_view");
  });

  test("fresh schema supports default timestamps and monthly provisioning", async () => {
    await pool.query("DROP TABLE public.moves; DROP TABLE public.games");
    const schema = fs.readFileSync(path.join(__dirname, "../database/schema.sql"), "utf8");
    await pool.query(schema);
    await service.ensureMonthlyPartitionsExist();
    const result = await pool.query(`INSERT INTO public.moves (move_number, player, from_position, to_position, piece, board_state_after)
      VALUES (1, 'white', '[6,4]', '[4,4]', 'P', '[]') RETURNING tableoid::regclass::text AS partition`);
    expect(result.rows[0].partition).toMatch(/^moves_\d{4}_\d{2}$/);
    // Extra bootstrap tables are isolated to this disposable database.
    await pool.query("DROP TABLE public.chat_messages; DROP TABLE public.users");
  });
});
