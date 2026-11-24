import { useCallback, useEffect, useRef, useState } from "react";
import type { GameState } from "../types/game";

export interface BroadcastClock {
  whiteMs: number;
  blackMs: number;
  turn: "white" | "black";
  paused?: boolean;
}

export interface BroadcastGame extends GameState {
  clock?: BroadcastClock | null;
}

export interface SpectatorTimerSync {
  gameCode?: string;
  whiteTimeMs: number;
  blackTimeMs: number;
  turn: "white" | "black";
  paused?: boolean;
  serverTimestamp?: number;
}

export interface BroadcastMove {
  ply: number;
  text: string;
}

interface BufferedGame {
  game: BroadcastGame;
  moveHistory: BroadcastMove[];
  serverTime: number;
  applyAt: number;
}

interface BroadcastView {
  scope: string;
  game: BroadcastGame | null;
  moveHistory: BroadcastMove[];
  releasedAt: number;
  now: number;
  nextApplyAt: number | null;
  queuedCount: number;
}

const EMPTY_VIEW: BroadcastView = {
  scope: "", game: null, moveHistory: [], releasedAt: 0, now: 0, nextApplyAt: null, queuedCount: 0,
};
const DELAYS = [15_000, 30_000, 60_000];

function isFinished(game: BroadcastGame) {
  return ["finished", "completed"].includes(game.status.toLowerCase());
}

function validClock(clock: BroadcastClock | null | undefined): clock is BroadcastClock {
  return Boolean(clock && Number.isFinite(clock.whiteMs) && clock.whiteMs >= 0
    && Number.isFinite(clock.blackMs) && clock.blackMs >= 0
    && (clock.turn === "white" || clock.turn === "black"));
}

function validPosition(position: unknown): position is [number, number] {
  return Array.isArray(position) && position.length === 2
    && position.every((value) => Number.isInteger(value) && value >= 0 && value < 8);
}

function moveHistoryFor(game: BroadcastGame, previous: BroadcastMove[]): BroadcastMove[] {
  const move = game.last_move;
  const ply = game.move_count;
  if (!move || !validPosition(move.from) || !validPosition(move.to)
    || typeof ply !== "number" || !Number.isInteger(ply) || ply <= 0) return previous;
  const square = ([row, column]: [number, number]) => `${"abcdefgh"[column]}${8 - row}`;
  const text = `${square(move.from)}–${square(move.to)}`;
  if (previous.at(-1)?.ply === ply && previous.at(-1)?.text === text) return previous;
  return [...previous.filter((entry) => entry.ply < ply), { ply, text }];
}

function copyGame(game: BroadcastGame): BroadcastGame {
  return {
    ...game,
    board_state: game.board_state.map((row) => [...row]),
    clock: validClock(game.clock) ? { ...game.clock } : null,
    captured_white: Array.isArray(game.captured_white) ? [...game.captured_white] : undefined,
    captured_black: Array.isArray(game.captured_black) ? [...game.captured_black] : undefined,
    last_move: game.last_move && validPosition(game.last_move.from) && validPosition(game.last_move.to) ? {
      ...game.last_move,
      from: [...game.last_move.from],
      to: [...game.last_move.to],
    } : undefined,
  };
}

function validGame(game: BroadcastGame | undefined): game is BroadcastGame {
  return Boolean(game && typeof game.status === "string"
    && (game.current_turn === "white" || game.current_turn === "black")
    && Array.isArray(game.board_state) && game.board_state.length === 8
    && game.board_state.every((row) => Array.isArray(row) && row.length === 8
      && row.every((piece) => typeof piece === "string" && /^[prnbqkPRNBQK.]$/.test(piece))));
}

/**
 * A viewer-side presentation delay. Incoming positions remain on the client;
 * server-enforced spectator privacy must be provided by the server separately.
 */
export function useDelayedBroadcast(gameCode: string | undefined, requestedDelay: number) {
  const delayMs = DELAYS.includes(requestedDelay) ? requestedDelay : 30_000;
  const scope = `${gameCode ?? ""}:${delayMs}`;
  const scopeRef = useRef("");
  const queueRef = useRef<BufferedGame[]>([]);
  const latestRef = useRef<BroadcastGame | null>(null);
  const movesRef = useRef<BroadcastMove[]>([]);
  const [view, setView] = useState<BroadcastView>(() => ({ ...EMPTY_VIEW, scope }));
  // Reset during the scope transition so navigating back cannot resurrect a
  // previously released position before the new feed's delay has elapsed.
  if (view.scope !== scope) setView({ ...EMPTY_VIEW, scope });

  useEffect(() => {
    scopeRef.current = scope;
    queueRef.current = [];
    latestRef.current = null;
    movesRef.current = [];
    const interval = window.setInterval(() => {
      const now = Date.now();
      const queue = queueRef.current;
      let readyCount = 0;
      while (readyCount < queue.length && queue[readyCount].applyAt <= now) readyCount += 1;
      const ready = readyCount > 0 ? queue[readyCount - 1] : null;
      const remaining = queue.slice(readyCount);
      queueRef.current = remaining;

      setView((current) => {
        const previous = current.scope === scope ? current : EMPTY_VIEW;
        if (!ready && remaining.length === 0 && !previous.game) return current;
        return {
          scope,
          game: ready?.game ?? previous.game,
          moveHistory: ready?.moveHistory ?? previous.moveHistory,
          releasedAt: ready?.applyAt ?? previous.releasedAt,
          now,
          nextApplyAt: remaining[0]?.applyAt ?? null,
          queuedCount: remaining.length,
        };
      });
    }, 200);

    return () => {
      window.clearInterval(interval);
      if (scopeRef.current === scope) {
        scopeRef.current = "";
        queueRef.current = [];
        latestRef.current = null;
        movesRef.current = [];
      }
    };
  }, [scope]);

  const receiveGame = useCallback((game: BroadcastGame | undefined, serverTime = Date.now(), source: "socket" | "snapshot" = "socket") => {
    if (scopeRef.current !== scope || !gameCode || !validGame(game)) return;
    if (game.game_code && game.game_code !== gameCode) return;
    const previous = latestRef.current;
    if (previous && isFinished(previous) && !isFinished(game)) return;
    // A slower initial GET must not overwrite a newer socket position or
    // same-ply timer_sync (including its pause state). Terminal confirmations
    // are authoritative and may still release the final buffer immediately.
    if (source === "snapshot" && previous && !isFinished(game)) {
      const newerPly = typeof previous.move_count === "number" && typeof game.move_count === "number"
        && game.move_count > previous.move_count;
      if (!newerPly) return;
    }

    const snapshot = copyGame(game);
    latestRef.current = snapshot;
    const moveHistory = moveHistoryFor(snapshot, movesRef.current);
    movesRef.current = moveHistory;
    const now = Date.now();
    if (isFinished(snapshot)) {
      queueRef.current = [];
      setView({ scope, game: snapshot, moveHistory, releasedAt: now, now, nextApplyAt: null, queuedCount: 0 });
      return;
    }

    const previousDeadline = queueRef.current.at(-1)?.applyAt ?? 0;
    const item: BufferedGame = {
      game: snapshot,
      moveHistory,
      serverTime: Number.isFinite(serverTime) ? serverTime : now,
      applyAt: Math.max(now + delayMs, previousDeadline),
    };
    const queue = [...queueRef.current, item];
    queueRef.current = queue;
    setView((current) => ({
      ...(current.scope === scope ? current : EMPTY_VIEW),
      scope, now, nextApplyAt: queue[0].applyAt, queuedCount: queue.length,
    }));
  }, [scope, gameCode, delayMs]);

  const receiveClock = useCallback((sync: SpectatorTimerSync) => {
    if (!sync || scopeRef.current !== scope || (sync.gameCode && sync.gameCode !== gameCode)) return;
    const game = latestRef.current;
    if (!game || isFinished(game)) return;
    const clock: BroadcastClock = {
      whiteMs: sync.whiteTimeMs,
      blackMs: sync.blackTimeMs,
      turn: sync.turn,
      paused: sync.paused,
    };
    if (!validClock(clock)) return;
    receiveGame({ ...game, clock }, sync.serverTimestamp);
  }, [scope, gameCode, receiveGame]);

  const visible = view.scope === scope ? view : EMPTY_VIEW;
  return {
    ...visible,
    countdownSeconds: visible.nextApplyAt === null
      ? 0 : Math.max(0, Math.ceil((visible.nextApplyAt - visible.now) / 1000)),
    delayMs,
    receiveGame,
    receiveClock,
  };
}
