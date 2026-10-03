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
