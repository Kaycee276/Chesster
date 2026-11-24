import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDelayedBroadcast, type BroadcastGame } from "../../src/hooks/useDelayedBroadcast";

const initialBoard = [
  ["r", "n", "b", "q", "k", "b", "n", "r"],
  ["p", "p", "p", "p", "p", "p", "p", "p"],
  ...Array.from({ length: 4 }, () => Array<string>(8).fill(".")),
  ["P", "P", "P", "P", "P", "P", "P", "P"],
  ["R", "N", "B", "Q", "K", "B", "N", "R"],
];

function game(moveCount = 0): BroadcastGame {
  return {
    game_code: "GAME-A",
    board_state: initialBoard.map((row) => [...row]),
    current_turn: moveCount % 2 === 0 ? "white" : "black",
    status: "active",
    move_count: moveCount,
    clock: { whiteMs: 60_000 - moveCount * 1000, blackMs: 60_000, turn: "white", paused: false },
  };
}

describe("useDelayedBroadcast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([15_000, 30_000, 60_000])("withholds initial board and clock for %i ms", (delay) => {
    const { result, unmount } = renderHook(() => useDelayedBroadcast("GAME-A", delay));
    act(() => result.current.receiveGame(game()));
    expect(result.current.game).toBeNull();
    expect(result.current.queuedCount).toBe(1);
    expect(result.current.countdownSeconds).toBe(delay / 1000);
    act(() => vi.advanceTimersByTime(delay - 1));
    expect(result.current.game).toBeNull();
    act(() => vi.advanceTimersByTime(201));
    expect(result.current.game?.board_state).toEqual(initialBoard);
    expect(result.current.game?.clock?.whiteMs).toBe(60_000);
    expect(result.current.queuedCount).toBe(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases successive board, turn, and clock snapshots in arrival order", () => {
    const { result, unmount } = renderHook(() => useDelayedBroadcast("GAME-A", 15_000));
    act(() => result.current.receiveGame(game()));
    act(() => vi.advanceTimersByTime(1000));
    const firstMove = game(1);
    const next = { ...firstMove, board_state: firstMove.board_state.map((row, r) =>
      row.map((piece, c) => r === 6 && c === 4 ? "." : r === 4 && c === 4 ? "P" : piece)
    ) };
    act(() => result.current.receiveGame(next));
    act(() => vi.advanceTimersByTime(14_000));
    expect(result.current.game?.move_count).toBe(0);
    expect(result.current.game?.current_turn).toBe("white");
    expect(result.current.game?.clock?.whiteMs).toBe(60_000);
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.game?.move_count).toBe(1);
    expect(result.current.game?.board_state[4][4]).toBe("P");
    expect(result.current.game?.current_turn).toBe("black");
    expect(result.current.game?.clock?.whiteMs).toBe(59_000);
    unmount();
  });

  it("buffers timer_sync updates and keeps the previous board until its own deadline", () => {
    const { result, unmount } = renderHook(() => useDelayedBroadcast("GAME-A", 15_000));
    act(() => result.current.receiveGame(game()));
    act(() => vi.advanceTimersByTime(15_000));
    act(() => result.current.receiveClock({
      gameCode: "GAME-A", whiteTimeMs: 45_000, blackTimeMs: 60_000,
      turn: "white", paused: true, serverTimestamp: 15_000,
    }));
    act(() => vi.advanceTimersByTime(14_999));
    expect(result.current.game?.clock?.whiteMs).toBe(60_000);
    act(() => vi.advanceTimersByTime(201));
    expect(result.current.game?.clock?.whiteMs).toBe(45_000);
    expect(result.current.game?.clock?.paused).toBe(true);
    expect(result.current.game?.board_state).toEqual(initialBoard);
    unmount();
  });

  it("copies queued payloads and rejects another game's or older API snapshots", () => {
    const { result, unmount } = renderHook(() => useDelayedBroadcast("GAME-A", 15_000));
    const payload = game(2);
    Object.freeze(payload.board_state);
    payload.board_state.forEach(Object.freeze);
    Object.freeze(payload.clock);
    Object.freeze(payload);
    act(() => result.current.receiveGame(payload));
    act(() => result.current.receiveGame(game(1), Date.now(), "snapshot"));
    act(() => result.current.receiveGame({ ...game(3), game_code: "GAME-B" }));
    act(() => vi.advanceTimersByTime(15_000));
    expect(result.current.game?.board_state).toEqual(initialBoard);
    expect(result.current.game?.board_state).not.toBe(payload.board_state);
    expect(result.current.game?.clock).not.toBe(payload.clock);
    expect(result.current.game?.move_count).toBe(2);
    expect(result.current.game?.clock?.whiteMs).toBe(58_000);
    unmount();
  });

  it("rejects a late same-ply GET after a newer paused timer sync without changing deadlines", () => {
    const { result, unmount } = renderHook(() => useDelayedBroadcast("GAME-A", 15_000));
    const slowGet = { ...game(2), clock: {
      whiteMs: 60_000, blackMs: 60_000, turn: "white" as const, paused: false,
    } };
    act(() => result.current.receiveGame(game(2)));
    act(() => vi.advanceTimersByTime(1000));
    act(() => result.current.receiveClock({
      gameCode: "GAME-A", whiteTimeMs: 45_000, blackTimeMs: 60_000,
      turn: "white", paused: true, serverTimestamp: 1000,
    }));
    act(() => vi.advanceTimersByTime(1000));
    act(() => result.current.receiveGame(slowGet, Date.now(), "snapshot"));
    expect(result.current.queuedCount).toBe(2);
    expect(result.current.countdownSeconds).toBe(13);
    act(() => vi.advanceTimersByTime(13_000));
    expect(result.current.game?.clock?.whiteMs).toBe(58_000);
    expect(result.current.game?.clock?.paused).toBe(false);
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.game?.clock?.whiteMs).toBe(45_000);
    expect(result.current.game?.clock?.paused).toBe(true);
    expect(result.current.queuedCount).toBe(0);
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.game?.clock?.whiteMs).toBe(45_000);
    expect(result.current.game?.clock?.paused).toBe(true);
    // The same-ply terminal API confirmation must still release immediately.
    act(() => result.current.receiveGame({ ...slowGet, status: "finished" }, Date.now(), "snapshot"));
    expect(result.current.game?.status).toBe("finished");
    expect(result.current.queuedCount).toBe(0);
    unmount();
  });

  it("retains every buffered move when several deadlines are drained together", () => {
    const { result, unmount } = renderHook(() => useDelayedBroadcast("GAME-A", 15_000));
    act(() => result.current.receiveGame({
      ...game(1), last_move: { from: [6, 4], to: [4, 4], piece: "P" },
    }));
    act(() => result.current.receiveGame({
      ...game(2), last_move: { from: [1, 4], to: [3, 4], piece: "p" },
    }));
    expect(result.current.moveHistory).toEqual([]);
    act(() => vi.advanceTimersByTime(15_000));
    expect(result.current.moveHistory).toEqual([
      { ply: 1, text: "e2–e4" }, { ply: 2, text: "e7–e5" },
    ]);
    unmount();
  });

  it("flushes immediately only for an official finished snapshot and ignores later live updates", () => {
    const { result, unmount } = renderHook(() => useDelayedBroadcast("GAME-A", 30_000));
    act(() => result.current.receiveGame(game()));
    act(() => result.current.receiveGame(game(1)));
    const completed = { ...game(2), status: "finished", winner: "white" };
    act(() => result.current.receiveGame(completed));
    expect(result.current.game?.status).toBe("finished");
    expect(result.current.game?.winner).toBe("white");
    expect(result.current.queuedCount).toBe(0);
    act(() => result.current.receiveGame(game(3)));
    act(() => vi.advanceTimersByTime(30_000));
    expect(result.current.game?.status).toBe("finished");
    unmount();
  });

  it("clears queued snapshots and hides the old board when the route or delay changes", () => {
    const { result, rerender, unmount } = renderHook(
      ({ code, delay }) => useDelayedBroadcast(code, delay),
      { initialProps: { code: "GAME-A", delay: 15_000 } },
    );
    const staleReceiver = result.current.receiveGame;
    act(() => result.current.receiveGame(game()));
    act(() => vi.advanceTimersByTime(15_000));
    expect(result.current.game).not.toBeNull();
    rerender({ code: "GAME-A", delay: 60_000 });
    expect(result.current.game).toBeNull();
    act(() => result.current.receiveGame(game(1)));
    rerender({ code: "GAME-B", delay: 60_000 });
    expect(result.current.game).toBeNull();
    act(() => staleReceiver(game(2)));
    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current.game).toBeNull();
    expect(result.current.queuedCount).toBe(0);
    rerender({ code: "GAME-A", delay: 15_000 });
    expect(result.current.game).toBeNull();
    expect(result.current.moveHistory).toEqual([]);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses a safe default for invalid delays and rejects malformed board/clock payloads", () => {
    const { result, unmount } = renderHook(() => useDelayedBroadcast("GAME-A", Number.NaN));
    act(() => result.current.receiveGame({ ...game(), board_state: [] }));
    expect(result.current.queuedCount).toBe(0);
    act(() => result.current.receiveClock({
      gameCode: "GAME-A", whiteTimeMs: -1, blackTimeMs: 60_000, turn: "white",
    }));
    expect(result.current.queuedCount).toBe(0);
    act(() => result.current.receiveGame(game()));
    expect(result.current.countdownSeconds).toBe(30);
    act(() => vi.advanceTimersByTime(30_000));
    expect(result.current.game).not.toBeNull();
    unmount();
  });
});
