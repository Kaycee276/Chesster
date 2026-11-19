import React from "react";
import { MOVE_QUALITY_META, type MoveClassification } from "../utils/moveAccuracy";
import type { ReplayedMove } from "../utils/pgnParser";
import { useGameStore } from "../store/gameStore";
import { FIGURINES, toFigurineNotation, formatMove } from "../utils/figurineNotation";

// eslint-disable-next-line react-refresh/only-export-components
export { FIGURINES, toFigurineNotation, formatMove };

export interface MoveListProps {
  moves: ReplayedMove[];
  currentIndex: number;
  classifications?: MoveClassification[];
  onSelectMove?: (index: number) => void;
  useFigurine?: boolean;
  onToggleFigurine?: () => void;
  showToggle?: boolean;
}

export const MoveList: React.FC<MoveListProps> = ({
  moves,
  currentIndex,
  classifications,
  onSelectMove,
  useFigurine: controlledUseFigurine,
  onToggleFigurine,
  showToggle = true,
}) => {
  const storeFigurine = useGameStore((s) => s.isFigurineNotation);
  const toggleStoreFigurine = useGameStore((s) => s.toggleFigurineNotation);

  const isFigurineActive = controlledUseFigurine ?? storeFigurine;
  const handleToggle = onToggleFigurine ?? toggleStoreFigurine;

  const rows: {
    num: number;
    white?: ReplayedMove;
    black?: ReplayedMove;
    whiteIndex: number;
    blackIndex: number;
  }[] = [];

  for (let i = 0; i < moves.length; i += 2) {
    rows.push({
      num: Math.floor(i / 2) + 1,
      white: moves[i],
      black: moves[i + 1],
      whiteIndex: i,
      blackIndex: i + 1,
    });
  }

  const renderBadge = (moveIndex: number) => {
    const classification = classifications?.[moveIndex];
    if (!classification) return null;
    const meta = MOVE_QUALITY_META[classification.quality];
    const cp = Math.round(classification.cpl);
    return (
      <span
        data-testid={`badge-${classification.quality}`}
        className={`acc-badge ${meta.className} ml-1`}
        title={`${meta.label}${cp > 0 ? ` (−${cp} cp)` : ""}`}
      >
        {meta.glyph}
      </span>
    );
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 rounded-xl bg-(--bg-secondary) border border-(--border) overflow-hidden">
      {showToggle && (
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-(--border)/60 bg-(--bg)/40 text-xs">
          <span className="font-semibold text-(--text-secondary) text-[11px] uppercase tracking-wider">
            Moves
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={isFigurineActive}
            aria-label="Toggle figurine notation"
            data-testid="toggle-figurine-notation"
            onClick={handleToggle}
            className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors flex items-center gap-1 border ${
              isFigurineActive
                ? "bg-(--accent-primary)/20 border-(--accent-primary) text-(--accent-primary)"
                : "border-(--border) text-(--text-tertiary) hover:text-(--text-secondary) hover:border-(--border)/80"
            }`}
            title={
              isFigurineActive
                ? "Figurine notation enabled (Unicode symbols)"
                : "Standard algebraic notation enabled"
            }
          >
            <span>{isFigurineActive ? "♘ Figurine" : "N Standard"}</span>
          </button>
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {moves.length === 0 ? (
          <p className="text-xs text-(--text-tertiary) text-center p-4">No moves played yet.</p>
        ) : (
          <table className="w-full text-xs font-mono">
            <tbody>
              {rows.map((r) => (
                <tr key={r.num} className="border-b border-(--border)/50 last:border-0">
                  <td className="px-2 py-1 text-(--text-tertiary) w-8">{r.num}.</td>
                  <td
                    onClick={() => onSelectMove?.(r.whiteIndex)}
                    className={`px-2 py-1 cursor-pointer hover:bg-(--bg)/60 ${
                      currentIndex === r.whiteIndex ? "bg-(--accent-dark)/40 font-bold" : ""
                    }`}
                  >
                    {r.white ? formatMove(r.white.san, "w", isFigurineActive) : null}
                    {renderBadge(r.whiteIndex)}
                  </td>
                  <td
                    onClick={() => r.black && onSelectMove?.(r.blackIndex)}
                    className={`px-2 py-1 cursor-pointer hover:bg-(--bg)/60 ${
                      currentIndex === r.blackIndex ? "bg-(--accent-dark)/40 font-bold" : ""
                    }`}
                  >
                    {r.black ? formatMove(r.black.san, "b", isFigurineActive) : null}
                    {r.black && renderBadge(r.blackIndex)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default MoveList;
