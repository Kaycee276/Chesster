import { useEffect, useState, useMemo, useRef } from "react";
import { useParams } from "react-router-dom";
import { Eye, Users, TrendingUp, TrendingDown, Minus, ArrowUpDown } from "lucide-react";
import EvaluationBar from "../components/EvaluationBar";
import { useStockfishEvaluation } from "../hooks/useStockfishEvaluation";
import { toEngineFen } from "../utils/engineEvaluation";
import { api } from "../api/gameApi";
import { socketService, type SpectatorPresence, type SpectatorReaction } from "../api/socket";
import SpectatorListModal from "../components/SpectatorListModal";
import type { GameState } from "../types/game";
import { useDelayedBroadcast, type SpectatorTimerSync } from "../hooks/useDelayedBroadcast";

type Orientation = "white" | "black";

const PIECE_SYMBOLS: Record<string, string> = {
  K: "\u2654",
  Q: "\u2655",
  R: "\u2656",
  B: "\u2657",
  N: "\u2658",
  P: "\u2659",
  k: "\u265A",
  q: "\u265B",
  r: "\u265C",
  b: "\u265D",
  n: "\u265E",
  p: "\u265F",
};

const PIECE_VALUES: Record<string, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0,
  P: 1,
  N: 3,
  B: 3,
  R: 5,
  Q: 9,
  K: 0,
};

const WHITE_PIECE_STYLE: React.CSSProperties = {
  color: "#ffffff",
  textShadow: "-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000",
};

const BLACK_PIECE_STYLE: React.CSSProperties = {
  color: "#111111",
  textShadow: "-1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff, 1px 1px 0 #fff",
};

const INITIAL_BOARD: string[][] = [
  ["r", "n", "b", "q", "k", "b", "n", "r"],
  ["p", "p", "p", "p", "p", "p", "p", "p"],
  [".", ".", ".", ".", ".", ".", ".", "."],
  [".", ".", ".", ".", ".", ".", ".", "."],
  [".", ".", ".", ".", ".", ".", ".", "."],
  [".", ".", ".", ".", ".", ".", ".", "."],
  ["P", "P", "P", "P", "P", "P", "P", "P"],
  ["R", "N", "B", "Q", "K", "B", "N", "R"],
];

function SpectatorBoard({ board, orientation }: { board: string[][]; orientation: Orientation }) {
  const flipped = orientation === "black";
  const displayIndices = flipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];

  return (
    <div
      className="rounded-sm overflow-hidden shadow-2xl"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(8, 1fr)",
        gridTemplateRows: "repeat(8, 1fr)",
        width: "100%",
        aspectRatio: "1",
      }}
    >
      {displayIndices.map((ri) =>
        displayIndices.map((ci) => {
          const piece = board[ri]?.[ci] ?? ".";
          const isLight = (ri + ci) % 2 === 0;
          return (
            <div
              key={`${ri}-${ci}`}
              className={`flex items-center justify-center ${
                isLight ? "bg-(--sq-light)" : "bg-(--sq-dark)"
              }`}
            >
              {piece !== "." && (
                <span
                  className="leading-none pointer-events-none"
                  style={{
                    fontSize: "min(5vw, 2.5rem)",
                    ...(piece === piece.toUpperCase() ? WHITE_PIECE_STYLE : BLACK_PIECE_STYLE),
                  }}
                >
                  {PIECE_SYMBOLS[piece]}
                </span>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

const REACTION_EMOJIS = ["🔥", "👏", "♟️", "🤯", "💀"];

function ReactionFloatingBar({ gameCode }: { gameCode: string }) {
  const reactionLocked = useRef(false);

  const sendReaction = (emoji: string) => {
    if (reactionLocked.current) return;
    reactionLocked.current = true;
    socketService.sendReaction(gameCode, emoji);
    window.setTimeout(() => {
      reactionLocked.current = false;
    }, 500);
  };

  return (
    <div className="absolute bottom-2 sm:bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full border border-(--border) bg-(--bg-secondary)/95 p-1.5 sm:p-2 shadow-xl backdrop-blur-sm">
      {REACTION_EMOJIS.map((emoji) => (
        <button
          type="button"
          key={emoji}
          onClick={() => sendReaction(emoji)}
          aria-label={`Send ${emoji} reaction`}
          className="rounded-full px-1.5 sm:px-2 py-0.5 sm:py-1 text-base sm:text-xl transition-transform hover:scale-125 focus-visible:scale-125"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

function FloatingReaction({ reaction }: { reaction: SpectatorReaction }) {
  return (
    <div
      className="pointer-events-none absolute bottom-20 z-10 text-3xl reaction-float-up"
      style={{ left: `${reaction.xOffset}%` }}
      aria-hidden="true"
    >
      {reaction.emoji}
    </div>
  );
}

export default function SpectatorPage() {
  const { gameCode } = useParams<{ gameCode: string }>();
  const [delayMs, setDelayMs] = useState(30_000);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { game: delayedGame, receiveGame, receiveClock, moveHistory, queuedCount, countdownSeconds, now, releasedAt } =
    useDelayedBroadcast(gameCode, delayMs);
  const board = delayedGame?.board_state ?? INITIAL_BOARD;
  const turn = delayedGame?.current_turn ?? "white";
  const gameLoaded = delayedGame !== null;
  const [orientation, setOrientation] = useState<Orientation>("white");
  const [spectators, setSpectators] = useState<SpectatorPresence[]>([]);
  const [isSpectatorListOpen, setSpectatorListOpen] = useState(false);
  // The viewer is always watching, so the count never drops below one.
  const spectatorCount = Math.max(spectators.length, 1);
  const [reactions, setReactions] = useState<SpectatorReaction[]>([]);

  const fen = useMemo(() => gameLoaded ? toEngineFen(board, turn) : null, [board, turn, gameLoaded]);
  const { evaluation: engineEvaluation, status: engineStatus } =
    useStockfishEvaluation(fen, { enabled: gameLoaded });
  // The engine retains its previous result while a new FEN is searched.
  // Spectators must only see scores for the position released by this feed.
  const evaluation = gameLoaded && engineEvaluation?.fen === fen ? engineEvaluation : null;
  const showEvaluation = fen !== null && engineStatus !== "error" && engineStatus !== "unsupported";

  const whiteMaterial = useMemo(() => {
    let total = 0;
    for (const row of board) {
      for (const p of row) {
        if (p !== "." && p === p.toUpperCase()) {
          total += PIECE_VALUES[p] ?? 0;
        }
      }
    }
    return total;
  }, [board]);

  const blackMaterial = useMemo(() => {
    let total = 0;
    for (const row of board) {
      for (const p of row) {
        if (p !== "." && p === p.toLowerCase()) {
          total += PIECE_VALUES[p] ?? 0;
        }
      }
    }
    return total;
  }, [board]);

  useEffect(() => {
    if (!gameCode) return;
    let active = true;
    const socket = socketService.connect();
    socketService.joinGame(gameCode);

    const queueGameState = (game: GameState | undefined) => {
      if (active) receiveGame(game);
    };
    const queueClock = (clock: SpectatorTimerSync) => {
      if (active) receiveClock(clock);
    };
    // A conclusion notification alone is not a board snapshot. Confirm the
    // persisted final state before releasing the remaining presentation buffer.
    const confirmConclusion = (event: { gameCode?: string }) => {
      if (!active || event?.gameCode !== gameCode) return;
      api.getGame(gameCode).then((res) => {
        if (active && res?.success && res.data &&
          ["finished", "completed"].includes(String(res.data.status).toLowerCase())) {
          queueGameState(res.data);
        }
      }).catch(() => {
        if (active) setLoadError("Unable to confirm the result. Waiting for a game update.");
      });
    };

    socketService.onGameUpdate(queueGameState);
    socket.on("timer_sync", queueClock);
    socket.on("game-ended", confirmConclusion);
    let reactionTimers: number[] = [];
    socketService.onReaction((reaction) => {
      if (!active) return;
      setReactions((current) => [...current, reaction]);
      const timer = window.setTimeout(() => {
        if (active) setReactions((current) => current.filter((item) => item.id !== reaction.id));
        reactionTimers = reactionTimers.filter((id) => id !== timer);
      }, 2000);
      reactionTimers = [...reactionTimers, timer];
    });

    socketService.onSpectatorJoined((spectator) => {
      if (!active) return;
      setSpectators((current) =>
        current.some((item) => item.address === spectator.address)
          ? current
          : [...current, spectator]
      );
    });
    socketService.onSpectatorLeft(({ address }) => {
      if (!active) return;
      setSpectators((current) => current.filter((item) => item.address !== address));
    });

    // The API uses snake_case for persisted game fields.
    api
      .getGame(gameCode)
      .then((res) => {
        if (active && res?.success) receiveGame(res.data, Date.now(), "snapshot");
      })
      .catch(() => {
        if (active) setLoadError("Unable to load this game. Waiting for a live update.");
      });

    return () => {
      active = false;
      socketService.offGameUpdate();
      socket.off("timer_sync", queueClock);
      socket.off("game-ended", confirmConclusion);
      reactionTimers.forEach((timer) => window.clearTimeout(timer));
      socketService.offReaction();
      socketService.offSpectatorPresence();
      socketService.leaveGame(gameCode);
      socketService.disconnect();
    };
  }, [gameCode, receiveGame, receiveClock]);

  const clockText = (color: "white" | "black") => {
    if (!delayedGame) return "—";
    const clock = delayedGame.clock;
    const baseSeconds = clock
      ? (color === "white" ? clock.whiteMs : clock.blackMs) / 1000
      : color === "white" ? delayedGame.white_time_left : delayedGame.black_time_left;
    if (typeof baseSeconds !== "number" || !Number.isFinite(baseSeconds)) return "—";
    const activeColor = clock?.turn ?? turn;
    const elapsed = delayedGame.status === "active" && !clock?.paused && color === activeColor
      ? Math.max(0, now - releasedAt) / 1000 : 0;
    const seconds = Math.max(0, Math.ceil(baseSeconds - elapsed));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  };

  return (
    <div className="min-h-screen bg-(--bg) flex flex-col">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-4 py-3 bg-(--bg-secondary) border-b border-(--border)">
        <div className="flex items-center gap-2">
          <Eye size={18} className="text-(--accent-primary)" />
          <span className="font-bold text-sm">Spectating</span>
          {gameCode && (
            <span className="text-xs text-(--text-tertiary) font-mono">
              {gameCode.slice(0, 8)}...
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setOrientation((o) => (o === "white" ? "black" : "white"))}
            className="flex items-center gap-1 text-xs text-(--text-secondary) hover:text-(--text) transition-colors"
            title="Flip board"
            aria-label="Flip board"
          >
            <ArrowUpDown size={14} />
            <span className="hidden sm:inline">Flip</span>
          </button>
          <button
            type="button"
            onClick={() => setSpectatorListOpen(true)}
            className="flex items-center gap-1 text-xs text-(--text-secondary) hover:text-(--text) transition-colors"
            title="Show spectators"
            aria-label={`Show spectators (${spectatorCount})`}
          >
            <Users size={14} />
            {spectatorCount}
          </button>
        </div>
      </div>

      {isSpectatorListOpen && (
        <SpectatorListModal
          spectators={spectators}
          onClose={() => setSpectatorListOpen(false)}
        />
      )}

      <div className="flex flex-wrap items-center justify-center gap-3 border-b border-(--border) px-4 py-2 text-xs">
        <span role="status" className="rounded-full bg-red-500/15 px-3 py-1 font-semibold text-red-300">
          🔴 Broadcast Delayed ({delayMs / 1000}s)
        </span>
        <label className="flex items-center gap-2">
          <span>Broadcast delay</span>
          <select
            aria-label="Broadcast delay"
            value={delayMs}
            onChange={(event) => setDelayMs(Number(event.target.value))}
            className="rounded border border-(--border) bg-(--bg-secondary) px-2 py-1 focus-visible:outline-2 focus-visible:outline-(--accent-primary)"
          >
            <option value={15_000}>15 seconds</option>
            <option value={30_000}>30 seconds</option>
            <option value={60_000}>60 seconds</option>
          </select>
        </label>
        <span aria-live="off" className="text-(--text-secondary)">
          {queuedCount > 0 ? `Next update in ${countdownSeconds}s · ${queuedCount} buffered` : "Buffer clear"}
        </span>
        <span aria-label={`White clock ${clockText("white")}`} className="font-mono">White {clockText("white")}</span>
        <span aria-label={`Black clock ${clockText("black")}`} className="font-mono">Black {clockText("black")}</span>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col lg:flex-row items-center justify-center p-4 gap-4">
        {/* Eval bar + board */}
        <div className="w-full max-w-lg flex items-stretch gap-2">
          {showEvaluation && (
            <EvaluationBar
              scoreCp={evaluation?.scoreCp ?? 0}
              mate={evaluation?.mate ?? null}
              depth={evaluation?.depth}
              orientation={orientation}
              loading={!evaluation}
            />
          )}
          <div className="relative flex-1 min-w-0">
            <SpectatorBoard board={board} orientation={orientation} />
            {reactions.map((reaction) => (
              <FloatingReaction key={reaction.id} reaction={reaction} />
            ))}
            {gameCode && <ReactionFloatingBar gameCode={gameCode} />}
          </div>
        </div>

        {/* Move list */}
        <div className="hidden md:flex flex-col w-48 bg-(--bg-secondary) border border-(--border) rounded-xl p-3 gap-2 h-full max-h-[80vh]">
          <h3 className="text-xs font-bold uppercase tracking-wider text-(--text-tertiary)">
            Received moves
          </h3>
          <div className="flex-1 overflow-y-auto text-xs font-mono text-(--text-secondary) space-y-0.5">
            {moveHistory.length === 0 && (
              <p className="text-(--text-tertiary) italic">No moves yet</p>
            )}
            {moveHistory.map((move) => (
              <div key={move.ply} className={move.ply % 2 === 1 ? "text-(--text)" : "text-(--text-secondary)"}>
                {move.ply % 2 === 1 && (
                  <span className="text-(--text-tertiary) mr-1">{Math.ceil(move.ply / 2)}.</span>
                )}
                {move.text}
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-(--border)">
            <div className="flex items-center gap-1 text-xs">
              <TrendingUp size={12} className="text-white" />
              <span className="font-mono">{whiteMaterial}</span>
            </div>
            <div className="flex items-center gap-1 text-xs">
              <span className="font-mono">{blackMaterial}</span>
              <TrendingDown size={12} className="text-gray-400" />
            </div>
          </div>
        </div>
      </div>

      {/* Bottom status bar */}
      <div className="shrink-0 flex items-center justify-center px-4 py-2 bg-(--bg-secondary) border-t border-(--border)">
        <div className="flex items-center gap-2 text-xs text-(--text-secondary)">
          <Minus size={12} />
          <span>
            {gameLoaded
              ? ["finished", "completed"].includes(delayedGame?.status.toLowerCase() ?? "")
                ? `Game finished · ${delayedGame?.winner === "draw" ? "Draw" : delayedGame?.winner ? `${delayedGame.winner} wins` : "Result confirmed"}`
                : `${turn === "white" ? "White" : "Black"} to move`
              : loadError ?? "Waiting for delayed game updates..."}
          </span>
          {evaluation && (
            <span className="font-mono text-(--text-tertiary)">
              · Stockfish depth {evaluation.depth}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
