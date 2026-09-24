process.env.SUPABASE_URL = "http://localhost";
process.env.SUPABASE_ANON_KEY = "test-key";

const gameModel = require("../models/gameModel");
const escrowService = require("../services/escrowService");
const chessEngine = require("../services/chessEngine");

// Mock Supabase
jest.mock("../config/supabase", () => {
  const mockSelect = jest.fn().mockReturnThis();
  const mockEq = jest.fn().mockReturnThis();
  const mockSingle = jest.fn().mockResolvedValue({ data: { id: 1, game_code: "GAME123", status: "waiting", player_white: true, player_black: false, player_white_address: "PLAYER1" }, error: null });
  const mockInsert = jest.fn().mockReturnThis();
  const mockUpdate = jest.fn().mockReturnThis();
  
  return {
    from: jest.fn().mockReturnValue({
      select: mockSelect,
      eq: mockEq,
      single: mockSingle,
      insert: mockInsert,
      update: mockUpdate,
    }),
  };
});

jest.mock("../services/escrowService", () => ({
  init: jest.fn(),
  getMatch: jest.fn().mockResolvedValue({ status: 1 }),
  resolveWithWinner: jest.fn().mockResolvedValue({}),
  resolveAsDraw: jest.fn().mockResolvedValue({}),
}));

jest.mock("../services/chessEngine", () => {
  const emptyBoard = Array(8).fill(Array(8).fill("."));
  return {
    initBoard: jest.fn().mockReturnValue(emptyBoard),
    isValidMove: jest.fn().mockReturnValue({ valid: true }),
    makeMove: jest.fn().mockReturnValue(emptyBoard),
    isKingInCheck: jest.fn().mockReturnValue(false),
    isCheckmate: jest.fn().mockReturnValue(false),
    isStalemate: jest.fn().mockReturnValue(false),
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
        expect(() => gameModel.assertValidStellarAddress(payload)).toThrow("Invalid wallet address");
      },
    );
  });

  describe("getGameHistory playerAddress filter", () => {
    it("rejects a malicious playerAddress before it reaches the query", async () => {
      await expect(
        gameModel.getGameHistory({ playerAddress: "GABC,status.eq.finished" }),
      ).rejects.toThrow("Invalid wallet address");
    });
  });

  describe("makeMove", () => {
    it("should record a valid move", async () => {
      gameModel.getGame = jest.fn().mockResolvedValue({
        id: 1,
        status: "active",
        board_state: Array(8).fill(Array(8).fill(".")),
        current_turn: "white",
        move_count: 0
      });
      const result = await gameModel.makeMove("GAME123", [6, 4], [4, 4]);
      expect(result).toBeDefined();
    });
  });
});
