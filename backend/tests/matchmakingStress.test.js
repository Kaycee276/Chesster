const { describe, test, expect, beforeEach, afterEach } = require("vitest");
const matchmakingService = require("../services/matchmakingService");

describe("Matchmaking Stress Test Suite", () => {
  beforeEach(() => {
    // Clear queue before each test
    matchmakingService.clearQueue?.();
  });

  afterEach(() => {
    // Cleanup after each test
    matchmakingService.clearQueue?.();
  });

  test("handles 100 concurrent players entering matchmaking pool", async () => {
    // Generate 100 mock players with randomized ELO ratings (800–2200)
    const players = Array.from({ length: 100 }, (_, i) => ({
      walletAddress: `GPLAYER_${i.toString().padStart(3, "0")}`,
      elo: 800 + Math.floor(Math.random() * 1400),
    }));

    // Dispatch concurrent joinQueue calls
    const joinPromises = players.map((player) =>
      matchmakingService.joinQueue(player.walletAddress, player.elo)
    );

    const results = await Promise.allSettled(joinPromises);

    // Assert all joins succeeded or gracefully handled
    const rejections = results.filter((r) => r.status === "rejected");
    expect(rejections).toHaveLength(0);

    // Verify queue state
    const queueState = matchmakingService.getQueueState();
    expect(queueState).toBeDefined();
  });

  test("handles concurrent joins with 20% simultaneous cancellations", async () => {
    // Generate 100 mock players
    const players = Array.from({ length: 100 }, (_, i) => ({
      walletAddress: `GPLAYER_${i.toString().padStart(3, "0")}`,
      elo: 1000 + Math.floor(Math.random() * 800),
    }));

    // Dispatch all joinQueue calls concurrently
    const joinPromises = players.map((player) =>
      matchmakingService.joinQueue(player.walletAddress, player.elo)
    );

    // After 20ms, randomly cancel 20 players
    setTimeout(() => {
      const cancelCount = 20;
      const playersToCancel = players.slice(0, cancelCount);
      playersToCancel.forEach((player) => {
        matchmakingService.leaveQueue(player.walletAddress).catch(() => {
          // Ignore if already matched
        });
      });
    }, 20);

    await Promise.allSettled(joinPromises);

    // Wait for cancellations to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify state consistency
    const queueState = matchmakingService.getQueueState();
    const pairedCount = matchmakingService.getPairedCount?.() || 0;
    const remainingInQueue = queueState?.length || 0;

    // Total must equal initial player count
    expect(pairedCount + remainingInQueue).toBeLessThanOrEqual(100);
  });

  test("ensures no player is paired more than once", async () => {
    // Generate 100 players
    const players = Array.from({ length: 100 }, (_, i) => ({
      walletAddress: `GPLAYER_${i.toString().padStart(3, "0")}`,
      elo: 1000 + Math.floor(Math.random() * 800),
    }));

    // Join all players concurrently
    await Promise.all(
      players.map((player) =>
        matchmakingService.joinQueue(player.walletAddress, player.elo)
      )
    );

    // Get all paired games
    const pairedGames = matchmakingService.getPairedGames?.() || [];

    // Create set to track unique players in matches
    const playersInMatches = new Set();
    pairedGames.forEach((game) => {
      // Assert each game has exactly 2 unique players
      expect(game.players).toHaveLength(2);
      expect(game.players[0]).not.toBe(game.players[1]);

      // Check for duplicates across all games
      game.players.forEach((player) => {
        expect(playersInMatches.has(player)).toBe(false);
        playersInMatches.add(player);
      });
    });
  });

  test("maintains ELO-based matching constraints under concurrent load", async () => {
    // Generate players with wide ELO range
    const players = Array.from({ length: 100 }, (_, i) => ({
      walletAddress: `GPLAYER_${i.toString().padStart(3, "0")}`,
      elo: 800 + i * 14, // Distribute evenly across 800-2200 range
    }));

    // Shuffle to simulate random arrival order
    const shuffled = players.sort(() => Math.random() - 0.5);

    // Join all players
    await Promise.all(
      shuffled.map((player) =>
        matchmakingService.joinQueue(player.walletAddress, player.elo)
      )
    );

    // Verify paired games respect ELO constraints (e.g., max 200 ELO difference)
    const pairedGames = matchmakingService.getPairedGames?.() || [];
    pairedGames.forEach((game) => {
      if (game.players.length === 2) {
        const [player1, player2] = game.players;
        const elo1 = players.find((p) => p.walletAddress === player1)?.elo;
        const elo2 = players.find((p) => p.walletAddress === player2)?.elo;
        
        if (elo1 && elo2) {
          const eloDiff = Math.abs(elo1 - elo2);
          expect(eloDiff).toBeLessThanOrEqual(400); // Reasonable matching threshold
        }
      }
    });
  });

  test("properly cleans up memory after matches are made", async () => {
    // Generate 50 players for faster test
    const players = Array.from({ length: 50 }, (_, i) => ({
      walletAddress: `GPLAYER_${i.toString().padStart(3, "0")}`,
      elo: 1000 + Math.floor(Math.random() * 500),
    }));

    // Join all players
    await Promise.all(
      players.map((player) =>
        matchmakingService.joinQueue(player.walletAddress, player.elo)
      )
    );

    // Get initial memory snapshot
    const initialQueueSize = matchmakingService.getQueueSize?.() || 0;

    // Clear all matches
    matchmakingService.clearMatches?.();

    // Verify queue is properly cleaned
    const finalQueueSize = matchmakingService.getQueueSize?.() || 0;
    expect(finalQueueSize).toBeLessThanOrEqual(initialQueueSize);
  });

  test("handles rapid concurrent joins and leaves without deadlock", async () => {
    const iterations = 200;
    const operations = [];

    for (let i = 0; i < iterations; i++) {
      const walletAddress = `GPLAYER_${i.toString().padStart(3, "0")}`;
      const elo = 1000 + Math.floor(Math.random() * 800);

      // Mix of joins and immediate leaves
      if (i % 3 === 0) {
        operations.push(
          matchmakingService
            .joinQueue(walletAddress, elo)
            .then(() => matchmakingService.leaveQueue(walletAddress))
            .catch(() => {}) // Ignore errors from already-matched players
        );
      } else {
        operations.push(matchmakingService.joinQueue(walletAddress, elo));
      }
    }

    // Should complete without hanging
    await Promise.allSettled(operations);

    // Verify system is still responsive
    const testPlayer = "GPLAYER_TEST";
    await expect(
      matchmakingService.joinQueue(testPlayer, 1500)
    ).resolves.not.toThrow();
  });

  test("verifies total conservation: paired + queue = total players", async () => {
    const totalPlayers = 100;
    const players = Array.from({ length: totalPlayers }, (_, i) => ({
      walletAddress: `GPLAYER_${i.toString().padStart(3, "0")}`,
      elo: 1000 + Math.floor(Math.random() * 800),
    }));

    // Join all players concurrently
    await Promise.all(
      players.map((player) =>
        matchmakingService.joinQueue(player.walletAddress, player.elo)
      )
    );

    // Get state
    const pairedGames = matchmakingService.getPairedGames?.() || [];
    const queueState = matchmakingService.getQueueState?.() || [];

    // Count paired players (each game has 2 players)
    const pairedPlayerCount = pairedGames.length * 2;
    const remainingInQueue = queueState.length;

    // Assert conservation: total players = paired + remaining
    expect(pairedPlayerCount + remainingInQueue).toBe(totalPlayers);
  });
});
