const { Server } = require("socket.io");
const { createAdapter } = require("@socket.io/redis-adapter");
const Redis = require("ioredis-mock");
const socketService = require("../services/socketService");

jest.mock("../config/redis", () => ({
  getRedisClient: jest.fn(),
}));

describe("Socket.io Redis Adapter Integration", () => {
  it("should successfully initialize adapter with mock Redis clients", () => {
    const pubClient = new Redis();
    const subClient = pubClient.duplicate();
    const io = new Server();

    expect(() => {
      io.adapter(createAdapter(pubClient, subClient));
    }).not.toThrow();
  });
});

describe("broadcastMoveWithPipeline (Issue #701)", () => {
  let mockRedis;
  let getRedisClient;

  beforeEach(() => {
    getRedisClient = require("../config/redis").getRedisClient;

    mockRedis = {
      pipeline: jest.fn(),
    };

    getRedisClient.mockReturnValue(mockRedis);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("batches move cache update, TTL refresh, and move counter into single pipeline", async () => {
    const mockPipeline = {
      set: jest.fn().mockReturnThis(),
      hincrby: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValueOnce([
        [null, "OK"],
        [null, "OK"],
        [null, 1],
        [null, "OK"],
      ]),
    };
    mockRedis.pipeline.mockReturnValue(mockPipeline);

    const boardState = { pieces: ["e2-e4"] };
    const result = await socketService.broadcastMoveWithPipeline("GAME123", boardState, {
      playerId: "PLAYER1",
      moveTimestampMs: 1000,
      ttlSeconds: 3600,
    });

    expect(result).toBe(true);
    expect(mockPipeline.set).toHaveBeenCalledWith(
      "game:GAME123:state",
      JSON.stringify(boardState),
      "EX",
      3600,
    );
    expect(mockPipeline.set).toHaveBeenCalledWith(
      "game:GAME123:last_move_at",
      "1000",
      "EX",
      3600,
    );
    expect(mockPipeline.hincrby).toHaveBeenCalledWith(
      "player:PLAYER1:stats",
      "moves_count",
      1,
    );
    expect(mockPipeline.exec).toHaveBeenCalledTimes(1);
  });

  it("executes pipeline without playerId when not provided", async () => {
    const mockPipeline = {
      set: jest.fn().mockReturnThis(),
      hincrby: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValueOnce([
        [null, "OK"],
        [null, "OK"],
      ]),
    };
    mockRedis.pipeline.mockReturnValue(mockPipeline);

    const boardState = { pieces: [] };
    const result = await socketService.broadcastMoveWithPipeline("GAME123", boardState, {
      ttlSeconds: 3600,
    });

    expect(result).toBe(true);
    expect(mockPipeline.hincrby).not.toHaveBeenCalled();
  });

  it("returns false when Redis is unavailable", async () => {
    getRedisClient.mockReturnValue(null);

    const result = await socketService.broadcastMoveWithPipeline("GAME123", {});
    expect(result).toBe(false);
  });

  it("handles pipeline execution errors gracefully", async () => {
    const mockPipeline = {
      set: jest.fn().mockReturnThis(),
      hincrby: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValueOnce([
        [new Error("Redis error"), null],
        [null, "OK"],
      ]),
    };
    mockRedis.pipeline.mockReturnValue(mockPipeline);

    const result = await socketService.broadcastMoveWithPipeline("GAME123", {});
    expect(result).toBe(false);
  });

  it("catches and logs pipeline execution exceptions", async () => {
    mockRedis.pipeline.mockImplementation(() => {
      throw new Error("Pipeline failed");
    });

    const result = await socketService.broadcastMoveWithPipeline("GAME123", {});
    expect(result).toBe(false);
  });
});

describe("getCachedGameState (Issue #701)", () => {
  let mockRedis;
  let getRedisClient;

  beforeEach(() => {
    getRedisClient = require("../config/redis").getRedisClient;
    mockRedis = { get: jest.fn() };
    getRedisClient.mockReturnValue(mockRedis);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("retrieves and parses cached game state", async () => {
    const boardState = { pieces: ["e2-e4"] };
    mockRedis.get.mockResolvedValueOnce(JSON.stringify(boardState));

    const result = await socketService.getCachedGameState("GAME123");
    expect(result).toEqual(boardState);
    expect(mockRedis.get).toHaveBeenCalledWith("game:GAME123:state");
  });

  it("returns null when cache key is not found", async () => {
    mockRedis.get.mockResolvedValueOnce(null);

    const result = await socketService.getCachedGameState("GAME123");
    expect(result).toBeNull();
  });

  it("returns null when Redis is unavailable", async () => {
    getRedisClient.mockReturnValue(null);

    const result = await socketService.getCachedGameState("GAME123");
    expect(result).toBeNull();
  });

  it("handles parse errors and returns null", async () => {
    mockRedis.get.mockResolvedValueOnce("not-valid-json{");

    const result = await socketService.getCachedGameState("GAME123");
    expect(result).toBeNull();
  });
});

describe("invalidateCachedGameState (Issue #701)", () => {
  let mockRedis;
  let getRedisClient;

  beforeEach(() => {
    getRedisClient = require("../config/redis").getRedisClient;
    mockRedis = { del: jest.fn() };
    getRedisClient.mockReturnValue(mockRedis);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("invalidates cached game state", async () => {
    mockRedis.del.mockResolvedValueOnce(2);

    const result = await socketService.invalidateCachedGameState("GAME123");
    expect(result).toBe(true);
    expect(mockRedis.del).toHaveBeenCalledWith(
      "game:GAME123:state",
      "game:GAME123:last_move_at",
    );
  });

  it("returns false when Redis is unavailable", async () => {
    getRedisClient.mockReturnValue(null);

    const result = await socketService.invalidateCachedGameState("GAME123");
    expect(result).toBe(false);
  });

  it("handles deletion errors gracefully", async () => {
    mockRedis.del.mockRejectedValueOnce(new Error("Redis error"));

    const result = await socketService.invalidateCachedGameState("GAME123");
    expect(result).toBe(false);
  });
});
