import React, { useState } from "react";
import { ListOrdered, MessageCircle, Info, ChevronUp, ChevronDown } from "lucide-react";
import { useGameStore } from "../store/gameStore";
import ChatPanel from "./ChatPanel";
import MoveList from "./MoveList";
import type { ReplayedMove } from "../utils/pgnParser";
import { squareToAlgebraic } from "../utils/chessUtils";

export type DrawerSnap = "collapsed" | "half" | "full";
export type DrawerTab = "moves" | "chat" | "info";

const snapHeights: Record<DrawerSnap, string> = {
  collapsed: "60px",
  half: "40vh",
  full: "85vh",
};

export interface MobileDrawerProps {
  initialSnap?: DrawerSnap;
  currentSnap?: DrawerSnap;
  onSnapChange?: (snap: DrawerSnap) => void;
  activeTab?: DrawerTab;
  onTabChange?: (tab: DrawerTab) => void;
  className?: string;
}

export default function MobileDrawer({
  initialSnap = "collapsed",
  currentSnap: controlledSnap,
  onSnapChange,
  activeTab: controlledTab,
  onTabChange,
  className = "",
}: MobileDrawerProps) {
  const [internalSnap, setInternalSnap] = useState<DrawerSnap>(initialSnap);
  const [internalTab, setInternalTab] = useState<DrawerTab>("moves");
  const [touchStartY, setTouchStartY] = useState<number | null>(null);

  const snap = controlledSnap ?? internalSnap;
  const tab = controlledTab ?? internalTab;

  const handleSnapChange = (nextSnap: DrawerSnap) => {
    setInternalSnap(nextSnap);
    onSnapChange?.(nextSnap);
  };

  const handleTabChange = (nextTab: DrawerTab) => {
    setInternalTab(nextTab);
    onTabChange?.(nextTab);
    if (snap === "collapsed") {
      handleSnapChange("half");
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStartY(e.touches[0].clientY);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartY === null) return;
    const endY = e.changedTouches[0].clientY;
    const deltaY = endY - touchStartY;
    setTouchStartY(null);

    if (deltaY < -40) {
      // Swiped UP
      if (snap === "collapsed") handleSnapChange("half");
      else if (snap === "half") handleSnapChange("full");
    } else if (deltaY > 40) {
      // Swiped DOWN
      if (snap === "full") handleSnapChange("half");
      else if (snap === "half") handleSnapChange("collapsed");
    }
  };

  const cycleSnap = () => {
    if (snap === "collapsed") handleSnapChange("half");
    else if (snap === "half") handleSnapChange("full");
    else handleSnapChange("collapsed");
  };

  // State from game store
  const {
    moveHistory,
    currentTurn,
    playerColor,
    status,
    secondsLeft,
    lastMove,
    gameCode,
  } = useGameStore();

  const replayedMoves: ReplayedMove[] = (moveHistory || []).map((m, idx) => ({
    moveNumber: Math.floor(idx / 2) + 1,
    color: m.player,
    san: `${squareToAlgebraic(m.from_position)}${m.piece.toLowerCase() === "p" ? "" : m.piece.toUpperCase()}-${squareToAlgebraic(m.to_position)}`,
    from: m.from_position,
    to: m.to_position,
    piece: m.piece,
    isCapture: false,
    isCheck: !!m.is_check,
    isCheckmate: !!m.is_checkmate,
    boardAfter: m.board_state_after,
  }));

  const lastMoveText = lastMove
    ? `${squareToAlgebraic(lastMove.from)}→${squareToAlgebraic(lastMove.to)}`
    : "None";

  const isExpanded = snap !== "collapsed";

  return (
    <>
      {/* Backdrop Scrim Blur on mobile when expanded */}
      {isExpanded && (
        <div
          data-testid="drawer-scrim"
          aria-label="Close drawer"
          className="fixed inset-0 bg-black/50 backdrop-blur-xs z-30 md:hidden transition-opacity duration-300"
          onClick={() => handleSnapChange("collapsed")}
        />
      )}

      {/* Touch-Draggable Bottom Sheet Drawer */}
      <div
        data-testid="mobile-drawer"
        style={{ height: snapHeights[snap] }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        className={`fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-700 rounded-t-2xl transition-all duration-300 z-40 md:hidden flex flex-col shadow-2xl overflow-hidden ${className}`}
      >
        {/* Drag Handle & Snap Toggle */}
        <div
          data-testid="drawer-handle"
          onClick={cycleSnap}
          className="w-full pt-2 pb-1 shrink-0 flex flex-col items-center cursor-grab active:cursor-grabbing hover:bg-white/5 transition-colors"
        >
          <div className="w-12 h-1.5 bg-gray-500 hover:bg-gray-400 rounded-full transition-colors" />
        </div>

        {/* Header / Tab Switcher */}
        <div className="shrink-0 px-3 py-1 flex items-center justify-between border-b border-gray-800 bg-gray-900/90">
          <div className="flex items-center gap-1">
            <button
              type="button"
              data-testid="drawer-tab-moves"
              onClick={() => handleTabChange("moves")}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                tab === "moves"
                  ? "bg-(--accent-primary) text-white"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              <ListOrdered size={13} />
              <span>Moves ({replayedMoves.length})</span>
            </button>

            <button
              type="button"
              data-testid="drawer-tab-chat"
              onClick={() => handleTabChange("chat")}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                tab === "chat"
                  ? "bg-(--accent-primary) text-white"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              <MessageCircle size={13} />
              <span>Chat</span>
            </button>

            <button
              type="button"
              data-testid="drawer-tab-info"
              onClick={() => handleTabChange("info")}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                tab === "info"
                  ? "bg-(--accent-primary) text-white"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              <Info size={13} />
              <span>Info</span>
            </button>
          </div>

          {/* Quick status when collapsed, or expand/collapse toggle */}
          <div className="flex items-center gap-2">
            {snap === "collapsed" ? (
              <div className="text-[11px] font-mono text-gray-300 flex items-center gap-1.5">
                <span className="text-gray-400">Move:</span>
                <span className="font-bold text-white">{lastMoveText}</span>
                {status === "active" && (
                  <span className="ml-1 text-(--accent-primary) font-bold">{secondsLeft}s</span>
                )}
                <button
                  type="button"
                  onClick={() => handleSnapChange("half")}
                  aria-label="Expand drawer"
                  className="p-1 text-gray-400 hover:text-white"
                >
                  <ChevronUp size={14} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => handleSnapChange("collapsed")}
                aria-label="Collapse drawer"
                className="p-1 rounded-lg text-gray-400 hover:text-white transition-colors"
              >
                <ChevronDown size={16} />
              </button>
            )}
          </div>
        </div>

        {/* Drawer Body (visible when expanded) */}
        {isExpanded && (
          <div className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col">
            {tab === "moves" && (
              <div className="flex-1 min-h-0 flex flex-col">
                <MoveList moves={replayedMoves} currentIndex={replayedMoves.length - 1} />
              </div>
            )}
            {tab === "chat" && (
              <div data-testid="drawer-chat-content" className="flex-1 min-h-0 flex flex-col">
                <ChatPanel inline={true} activeTab="chat" />
              </div>
            )}
            {tab === "info" && (
              <div className="flex flex-col gap-2 text-xs text-gray-300">
                <div className="flex justify-between py-1 border-b border-gray-800">
                  <span className="text-gray-400">Match Code:</span>
                  <span className="font-mono font-bold text-white">{gameCode || "—"}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-gray-800">
                  <span className="text-gray-400">Your Color:</span>
                  <span className="font-semibold capitalize text-white">{playerColor || "—"}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-gray-800">
                  <span className="text-gray-400">Current Turn:</span>
                  <span className="font-semibold capitalize text-white">{currentTurn}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-gray-400">Status:</span>
                  <span className="font-semibold uppercase text-(--accent-primary)">{status}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
