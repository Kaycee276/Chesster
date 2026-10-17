import React from "react";
import { MOVE_QUALITY_META, type MoveClassification } from "../utils/moveAccuracy";
import type { ReplayedMove } from "../utils/pgnParser";

export interface MoveListProps {
  moves: ReplayedMove[];
  currentIndex: number;
  classifications?: MoveClassification[];
  onSelectMove?: (index: number) => void;
}

export const MoveList: React.FC<MoveListProps> = ({
  moves,
  currentIndex,
  classifications,
  onSelectMove,
}) => {
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
    <div className="flex-1 min-h-0 overflow-y-auto rounded-xl bg-(--bg-secondary) border border-(--border)">
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
                  {r.white?.san}
                  {renderBadge(r.whiteIndex)}
                </td>
                <td
                  onClick={() => r.black && onSelectMove?.(r.blackIndex)}
                  className={`px-2 py-1 cursor-pointer hover:bg-(--bg)/60 ${
                    currentIndex === r.blackIndex ? "bg-(--accent-dark)/40 font-bold" : ""
                  }`}
                >
                  {r.black?.san}
                  {r.black && renderBadge(r.blackIndex)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default MoveList;
