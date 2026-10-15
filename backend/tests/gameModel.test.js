process.env.SUPABASE_URL = "http://localhost";
process.env.SUPABASE_ANON_KEY = "test-key";

const gameModel = require("../models/gameModel");
const escrowService = require("../services/escrowService");
const chessEngine = require("../services/chessEngine");

// Mock Supabase
jest.mock("../config/supabase", () => {
  const query = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    or: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    lte: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    range: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({
      data: {
        id: 1,
        game_code: "GAME123",
        status: "waiting",
        player_white: true,
        player_black: false,
        player_white_address: "PLAYER1",
      },
      error: null,
    }),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    then: function (resolve, reject) {
      return Promise.resolve({
        data: [{ id: 1, game_code: "GAME123", created_at: "2026-01-01" }],
        error: null,
        count: 1,
      }).then(resolve, reject);
    },
  };

  return {
    from: jest.fn().mockReturnValue(query),
    _mockQuery: query,
  };
});

jest.mock("../services/escrowService", () => ({
  init: jest.fn(),
  getMatch: jest.fn().mockResolvedValue({ status: 1 }),
  resolveWithWinner: jest.fn().mockResolvedValue({}),
  resolveAsDraw: jest.fn().mockResolvedValue({}),
}));

jest.mock("../services/referralService", () => ({
  creditReferralCommission: jest.fn().mockResolvedValue({ credited: true, amount: "20" }),
}));

jest.mock("../services/chessEngine", () => {
  const emptyBoard = Array(8).fill(Array(8).fill("."));
  return {
    initBoard: jest.fn().mockReturnValue(emptyBoard),
    isValidMove: jest.fn().mockReturnValue({ valid: true }),
    isValidVariantMove: jest.fn().mockReturnValue({ valid: true }),
    makeMove: jest.fn().mockReturnValue(emptyBoard),
    isKingInCheck: jest.fn().mockReturnValue(false),
    isCheckmate: jest.fn().mockReturnValue(false),
    isStalemate: jest.fn().mockReturnValue(false),
    getPositionKey: jest.fn().mockReturnValue("position-key"),
    checkDrawConditions: jest
      .fn()
      .mockReturnValue({ isDraw: false, canClaimDraw: false, reason: null }),
  };
});

describe("Game Model", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("createGame", () => {
    it("should create a new game successfully", async () => {
      const result = await gameModel.createGame("chess", 100, "PLAYER1", 600, "GAME123");
      expect(result.game_code).toBe("GAME123");
    });
  });

  describe("joinGame", () => {
    it("should allow a player to join a waiting game", async () => {
      const result = await gameModel.joinGame("GAME123", "black", "PLAYER2");
      expect(result.status).toBe("waiting");
    });
  });

  describe("assertValidStellarAddress (SQL/filter injection guard)", () => {
    const VALID_ADDRESS = "GA" + "A".repeat(54); // 56-char G-address

    it("returns a well-formed Stellar public key unchanged", () => {
      expect(gameModel.assertValidStellarAddress(VALID_ADDRESS)).toBe(VALID_ADDRESS);
    });

    it("accepts a well-formed contract (C) address", () => {
      const contractAddr = "CA" + "A".repeat(54);
      expect(gameModel.assertValidStellarAddress(contractAddr)).toBe(contractAddr);
    });

    it.each([
      ["a PostgREST filter-injection payload", "GABC,status.eq.finished"],
      ["a parenthesized or() injection", "x.or(status.eq.active)"],
      ["a classic SQL injection string", "' OR '1'='1"],
      ["an address with a trailing comma", VALID_ADDRESS + ","],
      ["a too-short value", "GABC"],
      ["lowercase characters", "ga" + "a".repeat(54)],
      ["an empty string", ""],
    ])("rejects %s", (_label, payload) => {
      expect(() => gameModel.assertValidStellarAddress(payload)).toThrow("Invalid wallet address");
    });

    it.each([[null], [undefined], [123], [{}], [["array"]]])(
      "rejects non-string input %p",
      (payload) => {
        expect(() => gameModel.assertValidStellarAddress(payload)).toThrow(
          "Invalid wallet address"
        );
      }
    );
  });

  describe("getGameHistory playerAddress filter", () => {
    it("rejects a malicious playerAddress before it reaches the query", async () => {
      await expect(
        gameModel.getGameHistory({ playerAddress: "GABC,status.eq.finished" })
      ).rejects.toThrow("Invalid wallet address");
    });
  });

  describe("getGameHistory sortBy and pagination validation", () => {
    it("rejects unsupported sort columns before querying database", async () => {
      await expect(gameModel.getGameHistory({ sortBy: "unknown_column" })).rejects.toThrow(
        "Invalid sortBy column: 'unknown_column'"
      );
      await expect(gameModel.getGameHistory({ sortBy: "drop table games" })).rejects.toThrow(
        "Invalid sortBy column"
      );
    });

    it("accepts all allowlisted sort columns", async () => {
      const allowed = [
        "id",
        "game_code",
        "game_type",
        "status",
        "player_white_address",
        "player_black_address",
        "wager_amount",
        "winner",
        "created_at",
        "updated_at",
        "move_count",
        "end_reason",
      ];
      for (const col of allowed) {
        await expect(gameModel.getGameHistory({ sortBy: col })).resolves.toBeDefined();
      }
    });

    it("normalizes valid sort order directions (asc, desc, ascending, descending)", async () => {
      await expect(gameModel.getGameHistory({ sortOrder: "asc" })).resolves.toBeDefined();
      await expect(gameModel.getGameHistory({ sortOrder: "desc" })).resolves.toBeDefined();
      await expect(gameModel.getGameHistory({ sortOrder: "ASCENDING" })).resolves.toBeDefined();
      await expect(gameModel.getGameHistory({ sortOrder: "DESCENDING" })).resolves.toBeDefined();
    });

    it("rejects invalid sortOrder values", async () => {
      await expect(gameModel.getGameHistory({ sortOrder: "invalid_dir" })).rejects.toThrow(
        "Invalid sortOrder: must be 'asc' or 'desc'"
      );
    });

    it("rejects non-positive, negative, zero, or malformed page values", async () => {
      await expect(gameModel.getGameHistory({ page: 0 })).rejects.toThrow("Invalid page");
      await expect(gameModel.getGameHistory({ page: -1 })).rejects.toThrow("Invalid page");
      await expect(gameModel.getGameHistory({ page: "-5" })).rejects.toThrow("Invalid page");
      await expect(gameModel.getGameHistory({ page: "abc" })).rejects.toThrow("Invalid page");
      await expect(gameModel.getGameHistory({ page: 2.5 })).rejects.toThrow("Invalid page");
    });

    it("rejects page values exceeding the maximum limit", async () => {
      await expect(gameModel.getGameHistory({ page: 1001 })).rejects.toThrow(
        "Page exceeds maximum allowed limit of 1000"
      );
      await expect(gameModel.getGameHistory({ page: "99999" })).rejects.toThrow(
        "Page exceeds maximum allowed limit of 1000"
      );
    });

    it("accepts valid numeric page strings and integers", async () => {
      const res1 = await gameModel.getGameHistory({ page: 2, pageSize: 10 });
      expect(res1.pagination.page).toBe(2);
      expect(res1.pagination.pageSize).toBe(10);

      const res2 = await gameModel.getGameHistory({ page: "3", pageSize: "15" });
      expect(res2.pagination.page).toBe(3);
      expect(res2.pagination.pageSize).toBe(15);
    });

    it("rejects malformed or negative pageSize values", async () => {
      await expect(gameModel.getGameHistory({ pageSize: 0 })).rejects.toThrow("Invalid pageSize");
      await expect(gameModel.getGameHistory({ pageSize: -10 })).rejects.toThrow("Invalid pageSize");
      await expect(gameModel.getGameHistory({ pageSize: "invalid" })).rejects.toThrow(
        "Invalid pageSize"
      );
      await expect(gameModel.getGameHistory({ pageSize: 10.5 })).rejects.toThrow(
        "Invalid pageSize"
      );
    });

    it("clamps pageSize values exceeding 100 to the maximum limit", async () => {
      const result = await gameModel.getGameHistory({ pageSize: 500 });
      expect(result.pagination.pageSize).toBe(100);
    });

    it("correctly calculates pagination metadata and boundaries", async () => {
      const result = await gameModel.getGameHistory({
        page: 1,
        pageSize: 20,
        sortBy: "created_at",
        sortOrder: "desc",
      });
      expect(result.pagination).toEqual({
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      });
    });
  });

  describe("makeMove", () => {
    it("should record a valid move", async () => {
      gameModel.getGame = jest.fn().mockResolvedValue({
        id: 1,
        status: "active",
        board_state: Array(8).fill(Array(8).fill(".")),
        current_turn: "white",
        move_count: 0,
      });
      const result = await gameModel.makeMove("GAME123", [6, 4], [4, 4]);
      expect(result).toBeDefined();
    });
  });
});
