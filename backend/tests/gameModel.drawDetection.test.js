process.env.SUPABASE_URL = "http://localhost";
process.env.SUPABASE_ANON_KEY = "test-key";

const gameModel = require("../models/gameModel");
const chessEngine = require("../services/chessEngine");

jest.mock("../config/supabase", () => {
  const mockSelect = jest.fn().mockReturnThis();
  const mockEq = jest.fn().mockReturnThis();
  const mockSingle = jest.fn().mockResolvedValue({ data: {}, error: null });
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

const emptyBoard = () => Array.from({ length: 8 }, () => Array(8).fill("."));

describe("Game Model - Draw Detection", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("makeMove", () => {
    it("automatically finishes the game as a draw on fivefold repetition", async () => {
      const board = emptyBoard();
      board[7][4] = "K";
      board[0][4] = "k";
      board[7][0] = "N";

      const positionHistory = Array(4).fill("repeated-key");

      gameModel.getGame = jest.fn().mockResolvedValue({
        id: 1,
        status: "active",
        board_state: board,
        current_turn: "white",
        move_count: 40,
        halfmove_clock: 8,
        position_history: positionHistory,
        captured_white: [],
        captured_black: [],
      });

      jest.spyOn(chessEngine, "getPositionKey").mockReturnValue("repeated-key");

      const capturedUpdate = jest.fn().mockReturnThis();
      const supabase = require("../config/supabase");
      supabase.from.mockImplementation((table) => {
        if (table === "games") {
          return {
            update: (payload) => {
              capturedUpdate(payload);
              return {
                eq: () => ({
                  select: () => ({
                    single: () => Promise.resolve({
                      data: { ...payload, game_code: "GAME1", wager_amount: null },
                      error: null,
                    }),
                  }),
                }),
              };
            },
          };
        }
        return {
          insert: () => Promise.resolve({ error: null }),
        };
      });

      const result = await gameModel.makeMove("GAME1", [7, 0], [5, 1]);

      expect(result.status).toBe("finished");
      expect(result.winner).toBe("draw");
      expect(result.end_reason).toBe("fivefold_repetition");
      expect(capturedUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "finished",
          winner: "draw",
          end_reason: "fivefold_repetition",
        }),
      );
    });

    it("marks the draw as claimable on threefold repetition without ending the game", async () => {
      const board = emptyBoard();
      board[7][4] = "K";
      board[0][4] = "k";
      board[7][0] = "N";

      const positionHistory = ["repeated-key", "other", "repeated-key"];

      gameModel.getGame = jest.fn().mockResolvedValue({
        id: 1,
        status: "active",
        board_state: board,
        current_turn: "white",
        move_count: 20,
        halfmove_clock: 4,
        position_history: positionHistory,
        captured_white: [],
        captured_black: [],
      });

      jest.spyOn(chessEngine, "getPositionKey").mockReturnValue("repeated-key");

      const capturedUpdate = jest.fn().mockReturnThis();
      const supabase = require("../config/supabase");
      supabase.from.mockImplementation((table) => {
        if (table === "games") {
          return {
            update: (payload) => {
              capturedUpdate(payload);
              return {
                eq: () => ({
                  select: () => ({
                    single: () => Promise.resolve({
                      data: { ...payload, game_code: "GAME1", wager_amount: null },
                      error: null,
                    }),
                  }),
                }),
              };
            },
          };
        }
        return {
          insert: () => Promise.resolve({ error: null }),
        };
      });

      const result = await gameModel.makeMove("GAME1", [7, 0], [5, 1]);

      expect(result.status).toBe("active");
      expect(result.draw_claimable).toBe(true);
      expect(result.draw_claim_reason).toBe("threefold_repetition");
    });
  });

  describe("claimDraw", () => {
    it("throws when the draw conditions are not met", async () => {
      gameModel.getGame = jest.fn().mockResolvedValue({
        status: "active",
        board_state: emptyBoard(),
        current_turn: "white",
        halfmove_clock: 0,
        position_history: [],
      });

      await expect(gameModel.claimDraw("GAME1")).rejects.toThrow("Draw cannot be claimed yet");
    });

    it("finishes the game as a draw when the 50-move rule applies", async () => {
      gameModel.getGame = jest.fn().mockResolvedValue({
        status: "active",
        board_state: emptyBoard(),
        current_turn: "white",
        halfmove_clock: 100,
        position_history: [],
        wager_amount: null,
      });

      const supabase = require("../config/supabase");
      supabase.from.mockImplementation(() => ({
        update: (payload) => ({
          eq: () => ({
            select: () => ({
              single: () => Promise.resolve({
                data: { ...payload, game_code: "GAME1" },
                error: null,
              }),
            }),
          }),
        }),
      }));

      const result = await gameModel.claimDraw("GAME1");

      expect(result.status).toBe("finished");
      expect(result.winner).toBe("draw");
      expect(result.end_reason).toBe("50_move_rule");
    });
  });
});
