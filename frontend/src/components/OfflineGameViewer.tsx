import { useState, useMemo } from "react";
import { ChevronLeft, ChevronRight, Home } from "lucide-react";
import type { ReplayMetadata } from "../utils/offlineStorage";

interface Move {
  from: [number, number];
  to: [number, number];
  promotion?: string;
}

interface OfflineGameViewerProps {
  replay: ReplayMetadata;
  onClose: () => void;
}

// Basic PGN parsing to extract moves
function parsePgn(pgn: string): Move[] {
  // Simple extraction: look for standard algebraic notation in the PGN text
  // For now, return empty array as a placeholder; full parsing is complex
  // In production, moveHistory would be persisted alongside PGN
  return [];
}

/**
 * Component to view and step through a cached game replay offline.
 * Displays game metadata, move list, and allows navigation through moves.
 */
export default function OfflineGameViewer({ replay, onClose }: OfflineGameViewerProps) {
  const [moveIndex, setMoveIndex] = useState(0);

  const moves = useMemo(() => parsePgn(replay.pgn), [replay.pgn]);

  const handlePreviousMove = () => {
    if (moveIndex > 0) setMoveIndex(moveIndex - 1);
  };

  const handleNextMove = () => {
    if (moveIndex < moves.length) setMoveIndex(moveIndex + 1);
  };

  const handleReset = () => {
    setMoveIndex(0);
  };

  return (
    <div className="h-dvh max-h-dvh w-dvw overflow-hidden flex flex-col bg-(--bg)">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-(--border)">
        <div className="flex-1">
          <p className="text-xs text-(--text-tertiary) uppercase tracking-wide">
            Game {replay.gameCode}
          </p>
          <p className="text-sm font-semibold">
            {replay.players?.white || "White"} vs {replay.players?.black || "Black"}
          </p>
          <p className="text-xs text-(--text-secondary)">
            Result: {replay.result || "Unknown"}
            {replay.endReason && ` (${replay.endReason})`}
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-lg hover:bg-(--bg-secondary) transition-colors"
          aria-label="Back to home"
        >
          <Home size={20} className="text-(--text-secondary) hover:text-(--text)" />
        </button>
      </div>

      {/* Main replay area - placeholder for board display */}
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <div className="text-center flex flex-col gap-4">
          <p className="text-lg font-semibold">Game Replay</p>
          <p className="text-sm text-(--text-secondary)">
            {moves.length} moves played
          </p>
          <p className="text-xs text-(--text-tertiary) max-w-xs">
            Move through the game using the controls below.
          </p>
        </div>
      </div>

      {/* PGN and Move Controls */}
      <div className="border-t border-(--border) p-4 flex flex-col gap-3">
        {/* Move navigation */}
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={handleReset}
            disabled={moveIndex === 0}
            className="px-3 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed bg-(--bg-secondary) hover:bg-(--border) transition-colors"
          >
            Start
          </button>
          <button
            onClick={handlePreviousMove}
            disabled={moveIndex === 0}
            className="p-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed bg-(--bg-secondary) hover:bg-(--border) transition-colors"
          >
            <ChevronLeft size={18} />
          </button>
          <span className="text-sm font-semibold px-2">
            {moveIndex} / {moves.length}
          </span>
          <button
            onClick={handleNextMove}
            disabled={moveIndex >= moves.length}
            className="p-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed bg-(--bg-secondary) hover:bg-(--border) transition-colors"
          >
            <ChevronRight size={18} />
          </button>
          <button
            onClick={() => setMoveIndex(moves.length)}
            disabled={moveIndex >= moves.length}
            className="px-3 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed bg-(--bg-secondary) hover:bg-(--border) transition-colors"
          >
            End
          </button>
        </div>

        {/* PGN display */}
        <div className="bg-(--bg-secondary) border border-(--border) rounded-lg p-3 max-h-20 overflow-y-auto">
          <p className="text-xs text-(--text-secondary) font-mono">{replay.pgn}</p>
        </div>
      </div>
    </div>
  );
}
