jest.mock("../models/gameModel", () => ({
  getGame: jest.fn(),
  getMoves: jest.fn(),
}));

const gameModel = require("../models/gameModel");
const gameController = require("../controllers/gameController");

/**
 * Covers the short-lived game-state snapshot cache added for reconnect /
 * state-reconciliation support (Issue #434): `getGameStateSnapshot` should
 * collapse duplicate Supabase round trips within its TTL, and
 * `invalidateGameStateSnapshot` should force a fresh read (used after every
 * move so a reconciling client never sees a stale move list).
 */
describe("gameController game-state snapshot cache (Issue #434)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // getGameStateSnapshot's cache lives on the gameController singleton for
  // the lifetime of the process, so each test uses its own game code to stay
  // isolated rather than relying on TTL expiry or a reset hook between tests.

  it("fetches the game and its moves on a cold cache", async () => {
    const game = { game_code: "SNAP_COLD", status: "active" };
    const moves = [{ move_number: 0 }];
    gameModel.getGame.mockResolvedValue(game);
    gameModel.getMoves.mockResolvedValue(moves);

    const snapshot = await gameController.getGameStateSnapshot("SNAP_COLD");

    expect(snapshot).toEqual({ game, moves });
    expect(gameModel.getGame).toHaveBeenCalledTimes(1);
    expect(gameModel.getMoves).toHaveBeenCalledTimes(1);
  });

  it("returns null without hitting getMoves when the game does not exist", async () => {
    gameModel.getGame.mockResolvedValue(null);

    const snapshot = await gameController.getGameStateSnapshot("SNAP_MISSING");

    expect(snapshot).toBeNull();
    expect(gameModel.getMoves).not.toHaveBeenCalled();
  });

  it("serves a repeated request from cache instead of refetching", async () => {
    const game = { game_code: "SNAP_CACHED", status: "active" };
    gameModel.getGame.mockResolvedValue(game);
    gameModel.getMoves.mockResolvedValue([]);

    await gameController.getGameStateSnapshot("SNAP_CACHED");
    await gameController.getGameStateSnapshot("SNAP_CACHED");

    expect(gameModel.getGame).toHaveBeenCalledTimes(1);
    expect(gameModel.getMoves).toHaveBeenCalledTimes(1);
  });

  it("refetches immediately after invalidateGameStateSnapshot", async () => {
    const game = { game_code: "SNAP_INVALIDATED", status: "active" };
    gameModel.getGame.mockResolvedValue(game);
    gameModel.getMoves.mockResolvedValue([]);

    await gameController.getGameStateSnapshot("SNAP_INVALIDATED");
    gameController.invalidateGameStateSnapshot("SNAP_INVALIDATED");
    await gameController.getGameStateSnapshot("SNAP_INVALIDATED");

    expect(gameModel.getGame).toHaveBeenCalledTimes(2);
    expect(gameModel.getMoves).toHaveBeenCalledTimes(2);
  });

  it("keeps per-game caches independent", async () => {
    gameModel.getGame.mockImplementation(async (code) => ({ game_code: code, status: "active" }));
    gameModel.getMoves.mockResolvedValue([]);

    await gameController.getGameStateSnapshot("GAME_A");
    await gameController.getGameStateSnapshot("GAME_B");
    await gameController.getGameStateSnapshot("GAME_A");

    expect(gameModel.getGame).toHaveBeenCalledTimes(2);
  });

  it("refetches once the TTL has elapsed", async () => {
    jest.useFakeTimers();
    try {
      const game = { game_code: "SNAP_TTL", status: "active" };
      gameModel.getGame.mockResolvedValue(game);
      gameModel.getMoves.mockResolvedValue([]);

      await gameController.getGameStateSnapshot("SNAP_TTL");
      jest.advanceTimersByTime(1000); // past the 500ms TTL
      await gameController.getGameStateSnapshot("SNAP_TTL");

      expect(gameModel.getGame).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});
