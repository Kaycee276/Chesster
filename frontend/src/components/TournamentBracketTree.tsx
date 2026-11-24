import React, { useState, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  buildRoundsFromMatches,
  type TreeMatch,
  type TreeRound,
  type MatchStatus,
  type BracketPlayerInfo,
} from "../utils/tournamentBracket";

export type { TreeMatch, TreeRound, MatchStatus, BracketPlayerInfo };

export interface TournamentBracketTreeProps {
  matches?: TreeMatch[];
  rounds?: TreeRound[];
  onMatchClick?: (gameCode: string) => void;
  status?: string;
}

interface ViewState {
  scale: number;
  x: number;
  y: number;
}

/** Bracket zoom bounds (#755): 0.5x overview to 2.0x card inspection. */
export const MIN_BRACKET_SCALE = 0.5;
export const MAX_BRACKET_SCALE = 2;
const ZOOM_STEP = 1.32;

const clampScale = (scale: number) =>
  Math.min(MAX_BRACKET_SCALE, Math.max(MIN_BRACKET_SCALE, scale));

export const TournamentBracketTree: React.FC<TournamentBracketTreeProps> = ({
  matches = [],
  rounds: initialRounds,
  onMatchClick,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const [viewState, setViewState] = useState<ViewState>({ scale: 1, x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [touchDistance, setTouchDistance] = useState(0);

  const rounds = initialRounds && initialRounds.length > 0
    ? initialRounds
    : buildRoundsFromMatches(matches);

  const handleMatchSelect = (match: TreeMatch) => {
    if (match.gameCode) {
      if (onMatchClick) {
        onMatchClick(match.gameCode);
      } else {
        navigate(`/game/${match.gameCode}`);
      }
    }
  };

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - viewState.x, y: e.clientY - viewState.y });
  }, [viewState]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    setViewState((prev) => ({
      ...prev,
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    }));
  }, [isDragging, dragStart]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Ctrl/Cmd + wheel (and plain wheel) zooms around the pointer so the
  // match under the cursor stays put while the bracket scales (#755).
  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    const pointerX = e.clientX - rect.left;
    const pointerY = e.clientY - rect.top;

    setViewState((prev) => {
      const scale = clampScale(prev.scale * zoomFactor);
      const ratio = scale / prev.scale;
      return {
        scale,
        x: pointerX - (pointerX - prev.x) * ratio,
        y: pointerY - (pointerY - prev.y) * ratio,
      };
    });
  }, []);

  const getTouchDistance = (touches: TouchList | React.TouchList): number => {
    if (touches.length < 2) return 0;
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2) {
      setTouchDistance(getTouchDistance(e.touches));
    } else if (e.touches.length === 1) {
      setIsDragging(true);
      setDragStart({ x: e.touches[0].clientX - viewState.x, y: e.touches[0].clientY - viewState.y });
    }
  }, [viewState]);

  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2) {
      const newDistance = getTouchDistance(e.touches);
      if (touchDistance > 0) {
        const zoomFactor = newDistance / touchDistance;
        setViewState((prev) => ({
          ...prev,
          scale: clampScale(prev.scale * zoomFactor),
        }));
      }
      setTouchDistance(newDistance);
    } else if (e.touches.length === 1 && isDragging) {
      setViewState((prev) => ({
        ...prev,
        x: e.touches[0].clientX - dragStart.x,
        y: e.touches[0].clientY - dragStart.y,
      }));
    }
  }, [isDragging, dragStart, touchDistance]);

  const handleTouchEnd = useCallback(() => {
    setIsDragging(false);
    setTouchDistance(0);
  }, []);

  const zoomIn = () => {
    setViewState((prev) => ({
      ...prev,
      scale: clampScale(prev.scale * ZOOM_STEP),
    }));
  };

  const zoomOut = () => {
    setViewState((prev) => ({
      ...prev,
      scale: clampScale(prev.scale / 1.2),
    }));
  };

  const resetView = () => {
    setViewState({ scale: 1, x: 0, y: 0 });
  };

  const fitToScreen = () => {
    if (containerRef.current && contentRef.current) {
      const containerWidth = containerRef.current.clientWidth;
      const containerHeight = containerRef.current.clientHeight;
      const contentWidth = contentRef.current.scrollWidth;
      const contentHeight = contentRef.current.scrollHeight;

      const scaleX = containerWidth / contentWidth;
      const scaleY = containerHeight / contentHeight;
      const scale = Math.min(scaleX, scaleY, 1);

      setViewState({
        scale: clampScale(scale),
        x: 0,
        y: 0,
      });
    }
  };

  return (
    <div
      ref={containerRef}
      data-testid="tournament-bracket-tree"
      className="relative w-full h-[600px] overflow-hidden p-4 select-none cursor-grab active:cursor-grabbing bg-slate-900"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div
        ref={contentRef}
        data-testid="bracket-content"
        className="flex gap-12 min-w-max items-center justify-start py-4"
        style={{
          transform: `translate(${viewState.x}px, ${viewState.y}px) scale(${viewState.scale})`,
          transformOrigin: '0 0',
          transition: isDragging ? 'none' : 'transform 0.1s ease-out',
        }}
      >
        {rounds.map((round, rIndex) => (
          <div
            key={round.title || rIndex}
            data-testid={`bracket-round-${rIndex}`}
            className="flex flex-col gap-6"
          >
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 text-center">
              {t(`tournament.${round.title.toLowerCase()}`, round.title)}
            </h3>

            <div className="flex flex-col justify-around gap-8 flex-1">
              {round.matches.map((m) => {
                const isActive = m.status === "active";
                const isFinished = m.status === "finished";
                const p1Winner = isFinished && m.winnerId && m.player1 && m.winnerId === m.player1.id;
                const p2Winner = isFinished && m.winnerId && m.player2 && m.winnerId === m.player2.id;

                return (
                  <div
                    key={m.id}
                    data-testid={`matchup-card-${m.id}`}
                    onClick={() => handleMatchSelect(m)}
                    className={`relative w-64 rounded-xl border p-3 bg-slate-800 transition-all ${
                      m.gameCode ? "cursor-pointer hover:border-amber-400 hover:shadow-lg" : ""
                    } ${
                      isActive
                        ? "border-green-500 shadow-[0_0_12px_rgba(34,197,94,0.35)]"
                        : "border-slate-700"
                    }`}
                  >
                    {/* Live pulse indicator */}
                    {isActive && (
                      <div className="absolute -top-1.5 -right-1.5 flex items-center gap-1 bg-green-500 text-slate-950 font-extrabold text-[10px] px-2 py-0.5 rounded-full shadow-sm animate-pulse">
                        <span className="w-1.5 h-1.5 rounded-full bg-white" />
                        {t("tournament.live", "LIVE")}
                      </div>
                    )}

                    {/* Match status badge if not active */}
                    {!isActive && (
                      <div className="text-[10px] uppercase font-semibold text-slate-400 mb-1.5 flex justify-between items-center">
                        <span>
                          {m.status === "finished"
                            ? t("tournament.finished", "Finished")
                            : m.status === "awaiting_opponent"
                            ? t("tournament.awaitingOpponent", "Awaiting Opponent")
                            : t("tournament.scheduled", "Pending")}
                        </span>
                      </div>
                    )}

                    {/* Player 1 */}
                    <div
                      className={`flex items-center justify-between text-sm py-1 px-1.5 rounded ${
                        p1Winner ? "bg-green-950/40 text-green-400 font-bold" : "text-slate-200"
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        {m.player1?.seed !== undefined && (
                          <span className="text-[10px] font-mono text-slate-400 bg-slate-700 px-1 rounded">
                            {m.player1.seed}
                          </span>
                        )}
                        {m.player1?.avatar && (
                          <img
                            src={m.player1.avatar}
                            alt=""
                            className="w-5 h-5 rounded-full object-cover"
                          />
                        )}
                        <span className="truncate">
                          {m.player1?.name || t("tournament.tbd", "TBD")}
                        </span>
                      </div>
                      <span className="font-mono text-xs">{m.player1?.score ?? "-"}</span>
                    </div>

                    <div className="h-px bg-slate-700/60 my-1" />

                    {/* Player 2 */}
                    <div
                      className={`flex items-center justify-between text-sm py-1 px-1.5 rounded ${
                        p2Winner ? "bg-green-950/40 text-green-400 font-bold" : "text-slate-200"
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        {m.player2?.seed !== undefined && (
                          <span className="text-[10px] font-mono text-slate-400 bg-slate-700 px-1 rounded">
                            {m.player2.seed}
                          </span>
                        )}
                        {m.player2?.avatar && (
                          <img
                            src={m.player2.avatar}
                            alt=""
                            className="w-5 h-5 rounded-full object-cover"
                          />
                        )}
                        <span className="truncate">
                          {m.player2?.name || t("tournament.tbd", "TBD")}
                        </span>
                      </div>
                      <span className="font-mono text-xs">{m.player2?.score ?? "-"}</span>
                    </div>

                    {/* Spectate CTA */}
                    {m.gameCode && (
                      <div className="mt-2 text-center text-xs text-amber-400 font-semibold hover:underline">
                        {t("tournament.spectateGame", "Watch /game/:code")}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Floating Zoom Controls */}
      <div className="absolute top-4 right-4 flex flex-col gap-1 bg-slate-800 p-1 rounded border border-slate-700 shadow-lg z-10">
        <button
          onClick={zoomIn}
          className="w-9 h-9 flex items-center justify-center rounded bg-slate-700 hover:bg-slate-600 text-slate-200 font-bold transition"
          title={t("tournament.zoomIn", "Zoom In")}
        >
          +
        </button>
        <button
          onClick={zoomOut}
          className="w-9 h-9 flex items-center justify-center rounded bg-slate-700 hover:bg-slate-600 text-slate-200 font-bold transition"
          title={t("tournament.zoomOut", "Zoom Out")}
        >
          −
        </button>
        <div className="h-px bg-slate-600 my-0.5" />
        <button
          onClick={fitToScreen}
          className="px-2 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-semibold transition"
          title={t("tournament.fitScreen", "Fit to Screen")}
        >
          Fit
        </button>
        <button
          onClick={resetView}
          className="px-2 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-semibold transition"
          title={t("tournament.resetView", "Reset View")}
        >
          Reset
        </button>
      </div>

      {/* Zoom Level Display */}
      <div
        aria-live="polite"
        className="absolute bottom-4 right-4 bg-slate-800 px-2 py-1 rounded border border-slate-700 text-xs text-slate-400 font-mono"
      >
        {Math.round(viewState.scale * 100)}%
      </div>
    </div>
  );
};

export default TournamentBracketTree;
