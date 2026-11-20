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
