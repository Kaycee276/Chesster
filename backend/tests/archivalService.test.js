const zlib = require("zlib");
const { ArchivalService, ARCHIVE_BATCH_SIZE } = require("../services/archivalService");

describe("ArchivalService", () => {
  const originalBucket = process.env.ARCHIVE_S3_BUCKET;

  beforeEach(() => {
    process.env.ARCHIVE_S3_BUCKET = "chesster-archives";
  });

  afterAll(() => {
    if (originalBucket === undefined) delete process.env.ARCHIVE_S3_BUCKET;
    else process.env.ARCHIVE_S3_BUCKET = originalBucket;
  });

  test("compresses, uploads, then purges a completed-game batch", async () => {
    const game = {
      id: "8cf3c343-6ed9-4c78-9335-0b1e20921f60",
      game_code: "OLD001",
      status: "completed",
      moves: [{ move_number: 1, player: "white" }],
      auditLogs: [],
      chatMessages: [],
    };
    const events = [];
    const repository = {
      fetchBatch: jest.fn().mockResolvedValueOnce([game]),
      purge: jest.fn(async () => {
        events.push("purge");
        return 1;
      }),
    };
    const s3Client = {
      send: jest.fn(async () => events.push("upload")),
    };
    const service = new ArchivalService({
      repository,
      s3Client,
      now: () => new Date("2026-09-25T12:00:00.000Z"),
    });
    const cutoff = new Date("2026-06-27T12:00:00.000Z");

    const result = await service.archiveOldGames(cutoff);

    expect(repository.fetchBatch).toHaveBeenCalledWith(cutoff, ARCHIVE_BATCH_SIZE);
    expect(events).toEqual(["upload", "purge"]);
    expect(repository.purge).toHaveBeenCalledWith([game.id], cutoff);
    const input = s3Client.send.mock.calls[0][0].input;
    expect(input).toMatchObject({
      Bucket: "chesster-archives",
      Key: "games/2026/09/games-1790337600000-0.json.gz",
      ContentEncoding: "gzip",
    });
    const snapshot = JSON.parse(zlib.gunzipSync(input.Body).toString("utf8"));
    expect(snapshot.games).toEqual([game]);
    expect(snapshot.cutoffDate).toBe(cutoff.toISOString());
    expect(result.archived).toBe(1);
  });

  test("does not purge when the S3 upload fails", async () => {
    const repository = {
      fetchBatch: jest.fn().mockResolvedValue([{ id: "game-id" }]),
      purge: jest.fn(),
    };
    const service = new ArchivalService({
      repository,
      s3Client: { send: jest.fn().mockRejectedValue(new Error("upload failed")) },
      now: () => new Date("2026-09-25T12:00:00.000Z"),
    });

    await expect(service.archiveOldGames(new Date("2026-06-01"))).rejects.toThrow("upload failed");
    expect(repository.purge).not.toHaveBeenCalled();
  });

  test("returns without uploading when no eligible games exist", async () => {
    const repository = { fetchBatch: jest.fn().mockResolvedValue([]), purge: jest.fn() };
    const s3Client = { send: jest.fn() };
    const service = new ArchivalService({ repository, s3Client });

    await expect(service.archiveOldGames(new Date("2026-06-01"))).resolves.toEqual({
      success: true,
      archived: 0,
      archives: [],
    });
    expect(s3Client.send).not.toHaveBeenCalled();
    expect(repository.purge).not.toHaveBeenCalled();
  });
});

describe("ArchivalService monthly partition maintenance", () => {
  function setup(existing = false) {
    const client = {
      query: jest.fn(async (sql) => ({ rows: sql.includes("pg_partitioned_table") || (existing && sql.includes("pg_inherits")) ? [{}] : [] })),
      release: jest.fn(),
    };
    const db = { getPool: () => ({ connect: jest.fn().mockResolvedValue(client) }) };
    const service = new ArchivalService({ db, now: () => new Date("2026-12-31T23:00:00Z") });
    return { client, service };
  }

  test("creates current and upcoming months with UTC bounds and year rollover", async () => {
    const { client, service } = setup();
    await expect(service.ensureMonthlyPartitionsExist()).resolves.toEqual({ success: true, partitions: ["moves_2026_12", "moves_2027_01", "moves_2027_02"] });
    const queries = client.query.mock.calls.map(([sql]) => sql);
    expect(queries[0]).toBe("BEGIN");
    expect(queries[1]).toContain("pg_advisory_xact_lock");
    expect(queries.filter((sql) => sql.startsWith("CREATE TABLE"))).toHaveLength(3);
    expect(queries.find((sql) => sql.includes("ATTACH PARTITION"))).toContain("FROM ('2026-12-01T00:00:00.000Z') TO ('2027-01-01T00:00:00.000Z')");
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("DELETE FROM public.moves_default"), ["2026-12-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z"]);
    expect(queries.at(-1)).toBe("COMMIT");
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test("existing attached partitions are idempotent and require no DDL", async () => {
    const { client, service } = setup(true);
    await service.ensureMonthlyPartitionsExist(new Date("2026-11-01T00:30:00+01:00"));
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("pg_inherits"), ["public.moves_2026_10"]);
    expect(client.query.mock.calls.some(([sql]) => /CREATE TABLE|LOCK TABLE|DELETE FROM/.test(sql))).toBe(false);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test("rejects invalid dates before connecting", async () => {
    const { client, service } = setup();
    await expect(service.ensureMonthlyPartitionsExist(new Date("invalid"))).rejects.toThrow("valid partition reference");
    await expect(service.ensureMonthlyPartitionsExist("2026-11-01")).rejects.toThrow("valid partition reference");
    expect(client.query).not.toHaveBeenCalled();
  });

  test("fails clearly on a database that has not been migrated", async () => {
    const { client, service } = setup();
    client.query.mockImplementation(async () => ({ rows: [] }));
    await expect(service.ensureMonthlyPartitionsExist()).rejects.toThrow("migration 031");
    expect(client.query).toHaveBeenLastCalledWith("ROLLBACK");
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test("rolls back and releases the connection if DDL fails", async () => {
    const { client, service } = setup();
    client.query.mockImplementation(async (sql) => {
      if (sql.startsWith("CREATE TABLE")) throw new Error("permission denied");
      return { rows: sql.includes("pg_partitioned_table") ? [{}] : [] };
    });
    await expect(service.ensureMonthlyPartitionsExist()).rejects.toThrow("permission denied");
    expect(client.query).toHaveBeenLastCalledWith("ROLLBACK");
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.query.mock.calls.some(([sql]) => sql.includes("ATTACH PARTITION"))).toBe(false);
  });
});

describe("ArchivalService soft-delete retention purge", () => {
  test("purges soft-deleted games older than retention period", async () => {
    const now = new Date("2026-12-15T12:00:00Z");
    const retentionDays = 90;
    const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

    const expiredGames = [
      { id: "game-1" },
      { id: "game-2" },
    ];

    const db = {
      from: jest.fn((table) => {
        if (table === "games") {
          return {
            select: jest.fn().mockReturnThis(),
            not: jest.fn().mockReturnThis(),
            lt: jest.fn().mockReturnThis(),
            limit: jest.fn().mockResolvedValue({ data: expiredGames, error: null }),
          };
        }
      }),
      prisma: {
        $transaction: jest.fn(async (ops) => {
          return ops.map(() => ({ count: 1 }));
        }),
        move: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
        matchAuditLog: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
        game: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
      },
    };

    const service = new ArchivalService({ db, now: () => now });
    const result = await service.purgeExpiredSoftDeletedGames(retentionDays, 500);

    expect(result).toBe(2);
    expect(db.prisma.$transaction).toHaveBeenCalled();
  });

  test("handles multiple batches for large delete operations", async () => {
    const now = new Date("2026-12-15T12:00:00Z");
    const batch1 = Array(500).fill(null).map((_, i) => ({ id: `game-${i}` }));
    const batch2 = [{ id: "game-500" }];
    let callCount = 0;

    const db = {
      from: jest.fn((table) => {
        if (table === "games") {
          return {
            select: jest.fn().mockReturnThis(),
            not: jest.fn().mockReturnThis(),
            lt: jest.fn().mockReturnThis(),
            limit: jest.fn().mockImplementation(() => {
              const result = callCount === 0 ? batch1 : batch2;
              callCount++;
              return Promise.resolve({ data: result, error: null });
            }),
          };
        }
      }),
      prisma: {
        $transaction: jest.fn(async (ops) => {
          return ops.map(() => ({ count: 1 }));
        }),
        move: { deleteMany: jest.fn() },
        matchAuditLog: { deleteMany: jest.fn() },
        game: { deleteMany: jest.fn() },
      },
    };

    const service = new ArchivalService({ db, now: () => now });
    const result = await service.purgeExpiredSoftDeletedGames(90, 500);

    expect(result).toBe(501);
    expect(db.prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  test("throws error on invalid retention days", async () => {
    const service = new ArchivalService({ db: {} });
    await expect(service.purgeExpiredSoftDeletedGames(0, 500)).rejects.toThrow("positive");
    await expect(service.purgeExpiredSoftDeletedGames(-10, 500)).rejects.toThrow("positive");
  });

  test("throws error on invalid batch size", async () => {
    const service = new ArchivalService({ db: {} });
    await expect(service.purgeExpiredSoftDeletedGames(90, 0)).rejects.toThrow("positive");
    await expect(service.purgeExpiredSoftDeletedGames(90, -1)).rejects.toThrow("positive");
  });

  test("handles database query errors gracefully", async () => {
    const db = {
      from: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        not: jest.fn().mockReturnThis(),
        lt: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: null, error: new Error("query failed") }),
      })),
    };

    const service = new ArchivalService({ db });
    await expect(service.purgeExpiredSoftDeletedGames(90, 500)).rejects.toThrow("query failed");
  });
});

describe("ArchivalService bounded move retention", () => {
  const chessEngine = require("../services/chessEngine");
  const { restoreArchivedMoves } = require("../services/moveArchive");

  function fixture() {
    const initial = chessEngine.initBoard();
    const afterWhite = chessEngine.makeMove(initial, [6, 4], [4, 4]);
    const finalBoard = chessEngine.makeMove(afterWhite, [1, 4], [3, 4]);
    const game = {
      id: "00000000-0000-0000-0000-000000000001", game_code: "ARCH01",
      status: "finished", winner: "draw", move_count: 2, board_state: finalBoard,
      current_turn: "white", ended_at: "2026-06-01T12:00:00Z",
      updated_at: "2026-06-01T12:00:00Z", created_at: "2026-06-01T11:00:00Z",
      game_started_at: "2026-06-01T11:00:00Z", time_control_seconds: 600,
      pgn: null, move_archive: null, moves_archived_at: null,
    };
    const moves = [
      { id: "move-1", game_id: game.id, move_number: 1, player: "white", piece: "P",
        from_position: [6, 4], to_position: [4, 4], board_state_after: afterWhite,
        created_at: "2026-06-01T11:00:10Z", evaluation_cp: 17 },
      { id: "move-2", game_id: game.id, move_number: 2, player: "black", piece: "p",
        from_position: [1, 4], to_position: [3, 4], board_state_after: finalBoard,
        created_at: "2026-06-01T11:00:20Z", promotion: null },
    ];
    return { game, moves };
  }

  function setup({ missing = false, deleteFails = false, updateFails = false, movesOverride } = {}) {
    const original = fixture();
    let state = { game: { ...original.game }, moves: movesOverride || original.moves };
    let snapshot;
    const client = {
      query: jest.fn(async (sql, params) => {
        if (sql === "BEGIN") { snapshot = state; return { rows: [] }; }
        if (sql === "ROLLBACK") { state = snapshot; return { rows: [] }; }
        if (sql.startsWith("SELECT g.*")) return { rows: missing ? [] : [state.game] };
        if (sql.startsWith("SELECT * FROM public.moves")) return { rows: state.moves };
        if (sql.startsWith("UPDATE public.games")) {
          if (updateFails) throw new Error("save failed");
          state = { ...state, game: { ...state.game, pgn: params[1], move_archive: params[2], moves_archived_at: params[3] } };
          return { rows: [state.game], rowCount: 1 };
        }
        if (sql.startsWith("DELETE FROM public.moves")) {
          if (deleteFails) throw new Error("delete failed");
          const count = state.moves.length;
          state = { ...state, moves: [] };
          return { rows: [], rowCount: count };
        }
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    const pool = {
      query: jest.fn(async () => ({ rows: [state.game] })),
      connect: jest.fn().mockResolvedValue(client),
    };
    const service = new ArchivalService({ db: { getPool: () => pool }, now: () => new Date("2026-11-22T12:00:00Z") });
    return { service, pool, client, original, state: () => state };
  }

  test("saves verified PGN and compressed complete replay before deleting moves", async () => {
    const { service, client, original, state } = setup();
    const result = await service.archiveOldGameMoves();
    expect(result).toMatchObject({ processed: 1, movesPruned: 2, candidates: 1, dryRun: false });
    expect(state().game.pgn).toContain("e4");
    expect(state().game.pgn).toContain("e5");
    expect(state().moves).toEqual([]);
    expect(restoreArchivedMoves(state().game, [])).toEqual(original.moves);
    const sql = client.query.mock.calls.map(([query]) => query);
    expect(sql.findIndex((query) => query.startsWith("UPDATE public.games")))
      .toBeLessThan(sql.findIndex((query) => query.startsWith("DELETE FROM public.moves")));
    expect(sql).toEqual(expect.arrayContaining(["BEGIN", "COMMIT"]));
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test("dry run returns bounded candidates without a write transaction", async () => {
    const { service, pool, state, original } = setup();
    const result = await service.archiveOldGameMoves({ olderThanDays: 120, batchSize: 12, dryRun: true });
    expect(result).toMatchObject({ candidates: 1, processed: 0, movesPruned: 0, dryRun: true });
    expect(pool.connect).not.toHaveBeenCalled();
    expect(pool.query.mock.calls[0][1][1]).toBe(12);
    expect(pool.query.mock.calls[0][0]).toContain("g.status IN ('finished', 'completed')");
    expect(pool.query.mock.calls[0][0]).toContain("COALESCE(g.ended_at, g.updated_at)");
    expect(pool.query.mock.calls[0][0]).toContain("g.updated_at < $1");
    expect(state().game).toEqual(original.game);
    expect(state().moves).toEqual(original.moves);
  });

  test("rechecks terminal status and age under a game lock and skips changed candidates", async () => {
    const { service, client, state } = setup({ missing: true });
    expect(await service.archiveOldGameMoves()).toMatchObject({ processed: 0 });
    const query = client.query.mock.calls.find(([sql]) => sql.startsWith("SELECT g.*"))[0];
    expect(query).toContain("FOR UPDATE OF g SKIP LOCKED");
    expect(query).toContain("g.moves_archived_at IS NULL");
    expect(query).toContain("g.deleted_at IS NULL");
    expect(client.query.mock.calls.some(([sql]) => sql.startsWith("DELETE"))).toBe(false);
    expect(state().moves).toHaveLength(2);
  });

  test.each(["update", "delete"])("rolls back archive and rows if %s fails", async (stage) => {
    const { service, client, original, state } = setup({ updateFails: stage === "update", deleteFails: stage === "delete" });
    await expect(service.archiveOldGameMoves()).rejects.toThrow(stage === "update" ? "save failed" : "delete failed");
    expect(client.query).toHaveBeenLastCalledWith("ROLLBACK");
    expect(state().game).toEqual(original.game);
    expect(state().moves).toEqual(original.moves);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test("retains incomplete or inconsistent move sequences", async () => {
    const { service, client, state } = setup({ movesOverride: fixture().moves.slice(1) });
    const result = await service.archiveOldGameMoves();
    expect(result).toMatchObject({ processed: 0, skipped: 1, movesPruned: 0 });
    expect(state().moves).toHaveLength(1);
    expect(client.query.mock.calls.some(([sql]) => sql.startsWith("DELETE"))).toBe(false);
  });

  test("subsequent runs skip games whose move rows were already archived", async () => {
    const { service, pool, state } = setup();
    await service.archiveOldGameMoves();
    pool.query.mockResolvedValueOnce({ rows: [] });
    expect(await service.archiveOldGameMoves()).toMatchObject({ processed: 0, candidates: 0 });
    expect(restoreArchivedMoves(state().game, [])).toHaveLength(2);
  });

  test.each([
    { olderThanDays: 0 }, { olderThanDays: -1 }, { olderThanDays: NaN },
    { olderThanDays: "90" }, { batchSize: 0 }, { batchSize: 5001 },
    { batchSize: 1.5 }, { dryRun: "false" },
  ])("rejects unsafe options before connecting: %p", async (options) => {
    const { service, pool } = setup();
    await expect(service.archiveOldGameMoves(options)).rejects.toThrow(/olderThanDays|batchSize|dryRun/);
    expect(pool.query).not.toHaveBeenCalled();
    expect(pool.connect).not.toHaveBeenCalled();
  });

  test("corrupted archive fails loudly instead of returning an empty replay", async () => {
    expect(() => restoreArchivedMoves({ moves_archived_at: "2026-11-22", move_archive: "invalid", move_count: 2 }, []))
      .toThrow(/move archive/i);
  });
});
