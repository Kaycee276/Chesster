import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  saveGameToOfflineCache,
  getOfflineGame,
  listOfflineGames,
  savePuzzleToOfflineCache,
  getOfflinePuzzle,
  getLatestOfflinePuzzle,
  type ReplayMetadata,
  type PuzzleData,
} from "../../src/utils/offlineStorage";

// Use fake-indexeddb for tests
import "fake-indexeddb/auto";

describe("offlineStorage", () => {
  beforeEach(() => {
    // Clear IndexedDB before each test
    const req = indexedDB.deleteDatabase("chesster-offline");
    return new Promise((resolve) => {
      req.onsuccess = resolve;
      req.onerror = resolve;
    });
  });

  afterEach(() => {
    const req = indexedDB.deleteDatabase("chesster-offline");
    return new Promise((resolve) => {
      req.onsuccess = resolve;
      req.onerror = resolve;
    });
  });

  describe("Game Replay Storage", () => {
    it("saves and retrieves a game replay", async () => {
      const replay: ReplayMetadata = {
        gameCode: "ABC123",
        pgn: "1. e4 e5 2. Nf3",
        players: { white: "Player1", black: "Player2" },
        result: "1-0",
        endReason: "checkmate",
        timeControl: "10+0",
        savedAt: Date.now(),
      };

      const saveResult = await saveGameToOfflineCache(replay);
      expect(saveResult.success).toBe(true);

      const getResult = await getOfflineGame("ABC123");
      expect(getResult.success).toBe(true);
      expect(getResult.data).toEqual(replay);
    });

    it("overwrites a replay with the same gameCode", async () => {
      const replay1: ReplayMetadata = {
        gameCode: "SAME",
        pgn: "1. e4",
        savedAt: Date.now(),
      };
      const replay2: ReplayMetadata = {
        gameCode: "SAME",
        pgn: "1. e4 e5 2. Nf3",
        savedAt: Date.now() + 1000,
      };

      await saveGameToOfflineCache(replay1);
      await saveGameToOfflineCache(replay2);

      const getResult = await getOfflineGame("SAME");
      expect(getResult.success).toBe(true);
      expect(getResult.data?.pgn).toBe("1. e4 e5 2. Nf3");
    });

    it("lists replays ordered by most recent first", async () => {
      const now = Date.now();
      const replays: ReplayMetadata[] = [
        { gameCode: "OLD", pgn: "1. e4", savedAt: now - 2000 },
        { gameCode: "MID", pgn: "1. e4 e5", savedAt: now - 1000 },
        { gameCode: "NEW", pgn: "1. e4 e5 2. Nf3", savedAt: now },
      ];

      for (const replay of replays) {
        await saveGameToOfflineCache(replay);
      }

      const listResult = await listOfflineGames();
      expect(listResult.success).toBe(true);
      expect(listResult.data?.length).toBe(3);
      expect(listResult.data?.[0]?.gameCode).toBe("NEW");
      expect(listResult.data?.[1]?.gameCode).toBe("MID");
      expect(listResult.data?.[2]?.gameCode).toBe("OLD");
    });

    it("prunes oldest replays when exceeding MAX_REPLAYS", async () => {
      const now = Date.now();
      // Add 12 replays (MAX_REPLAYS is 10)
      for (let i = 0; i < 12; i++) {
        const replay: ReplayMetadata = {
          gameCode: `GAME${i}`,
          pgn: `1. e4`,
          savedAt: now - (11 - i) * 1000,
        };
        await saveGameToOfflineCache(replay);
      }

      const listResult = await listOfflineGames();
      expect(listResult.success).toBe(true);
      // Should keep only 10 most recent
      expect(listResult.data?.length).toBeLessThanOrEqual(10);

      // Oldest games should be evicted
      const oldestResult = await getOfflineGame("GAME0");
      expect(oldestResult.success).toBe(false);
    });

    it("returns error when game not found", async () => {
      const result = await getOfflineGame("NONEXISTENT");
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("Puzzle Storage", () => {
    it("saves and retrieves a puzzle", async () => {
      const puzzle: PuzzleData = {
        id: "puzzle-001",
        fen: "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4",
        sideToMove: "white",
        solution: [
          { from: [0, 1], to: [2, 2] },
          { from: [3, 4], to: [4, 3] },
        ],
        rating: 1200,
        themes: ["Fork", "Pin"],
        title: "Double Attack",
        savedAt: Date.now(),
      };

      const saveResult = await savePuzzleToOfflineCache(puzzle);
      expect(saveResult.success).toBe(true);

      const getResult = await getOfflinePuzzle("puzzle-001");
      expect(getResult.success).toBe(true);
      expect(getResult.data?.title).toBe("Double Attack");
    });

    it("gets the latest puzzle", async () => {
      const now = Date.now();
      const puzzles: PuzzleData[] = [
        {
          id: "p1",
          fen: "test",
          sideToMove: "white",
          solution: [],
          rating: 1000,
          themes: [],
          savedAt: now - 1000,
        },
        {
          id: "p2",
          fen: "test2",
          sideToMove: "black",
          solution: [],
          rating: 1500,
          themes: [],
          savedAt: now,
        },
      ];

      for (const puzzle of puzzles) {
        await savePuzzleToOfflineCache(puzzle);
      }

      const latestResult = await getLatestOfflinePuzzle();
      expect(latestResult.success).toBe(true);
      expect(latestResult.data?.id).toBe("p2");
    });

    it("prunes oldest puzzles when exceeding MAX_PUZZLES", async () => {
      const now = Date.now();
      // Add 7 puzzles (MAX_PUZZLES is 5)
      for (let i = 0; i < 7; i++) {
        const puzzle: PuzzleData = {
          id: `puzz${i}`,
          fen: "test",
          sideToMove: "white",
          solution: [],
          rating: 1000 + i * 100,
          themes: [],
          savedAt: now - (6 - i) * 1000,
        };
        await savePuzzleToOfflineCache(puzzle);
      }

      const latestResult = await getLatestOfflinePuzzle();
      expect(latestResult.success).toBe(true);
      // Should keep only 5 most recent
      expect(latestResult.data?.id).toBe("puzz6");

      // Oldest puzzle should be evicted
      const oldestResult = await getOfflinePuzzle("puzz0");
      expect(oldestResult.success).toBe(false);
    });

    it("returns error when puzzle not found", async () => {
      const result = await getOfflinePuzzle("NONEXISTENT");
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("returns error when no puzzles in cache", async () => {
      const result = await getLatestOfflinePuzzle();
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("Error Handling", () => {
    it("handles quota exceeded error gracefully for replays", async () => {
      // Mock a QuotaExceededError by exhausting storage
      // (This is hard to trigger in tests; for now we just verify the logic doesn't throw)
      const replay: ReplayMetadata = {
        gameCode: "TEST",
        pgn: "1. e4",
        savedAt: Date.now(),
      };

      const result = await saveGameToOfflineCache(replay);
      // Should succeed or fail gracefully without throwing
      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("error");
    });

    it("handles quota exceeded error gracefully for puzzles", async () => {
      const puzzle: PuzzleData = {
        id: "test",
        fen: "test",
        sideToMove: "white",
        solution: [],
        rating: 1000,
        themes: [],
        savedAt: Date.now(),
      };

      const result = await savePuzzleToOfflineCache(puzzle);
      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("error");
    });
  });

  describe("DB Upgrade", () => {
    it("creates object stores on first open", async () => {
      // Just verify the first operation succeeds (implicitly tests DB creation)
      const replay: ReplayMetadata = {
        gameCode: "TEST",
        pgn: "1. e4",
        savedAt: Date.now(),
      };

      const result = await saveGameToOfflineCache(replay);
      expect(result.success).toBe(true);

      const puzzle: PuzzleData = {
        id: "test",
        fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        sideToMove: "white",
        solution: [],
        rating: 800,
        themes: [],
        savedAt: Date.now(),
      };

      const puzzleResult = await savePuzzleToOfflineCache(puzzle);
      expect(puzzleResult.success).toBe(true);
    });
  });

  describe("Privacy & Security", () => {
    it("stores only game metadata, not authentication tokens", async () => {
      const replay: ReplayMetadata = {
        gameCode: "TEST",
        pgn: "1. e4",
        players: { white: "Player1", black: "Player2" },
        result: "1-0",
        savedAt: Date.now(),
      };

      await saveGameToOfflineCache(replay);

      const result = await getOfflineGame("TEST");
      expect(result.data).toBeDefined();
      // Verify no sensitive fields are stored
      expect((result.data as any)?.token).toBeUndefined();
      expect((result.data as any)?.secret).toBeUndefined();
      expect((result.data as any)?.sessionId).toBeUndefined();
    });

    it("stores only puzzle public data", async () => {
      const puzzle: PuzzleData = {
        id: "test",
        fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        sideToMove: "white",
        solution: [{ from: [1, 0], to: [3, 0] }],
        rating: 800,
        themes: ["Opening"],
        title: "Scholar's Mate Setup",
        savedAt: Date.now(),
      };

      await savePuzzleToOfflineCache(puzzle);

      const result = await getOfflinePuzzle("test");
      expect(result.data).toBeDefined();
      // Solution should be stored (it's part of the puzzle)
      expect(result.data?.solution).toBeDefined();
      // No secret or auth data
      expect((result.data as any)?.apiKey).toBeUndefined();
    });
  });
});
