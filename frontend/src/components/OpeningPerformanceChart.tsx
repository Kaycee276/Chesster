import { useId, useState } from "react";
import type { OpeningStat } from "../utils/profileStats";

interface OpeningPerformanceChartProps {
  stats: readonly OpeningStat[];
}

const countLabel = (count: number, singular: string) => `${count} ${singular}${count === 1 ? "" : "s"}`;
const statKey = (stat: OpeningStat) => JSON.stringify([stat.name, stat.eco]);
const details = (stat: OpeningStat) =>
  `${stat.name}${stat.eco ? ` (${stat.eco})` : ""}: ${countLabel(stat.total, "game")}, ${countLabel(stat.wins, "win")}, ${countLabel(stat.draws, "draw")}, ${countLabel(stat.losses, "loss")}, ${stat.winRate}% win rate`;

/** Responsive stacked performance bars with the same details on hover, focus or tap. */
export default function OpeningPerformanceChart({ stats }: OpeningPerformanceChartProps) {
  const tooltipId = useId();
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const active = stats.find((stat) => statKey(stat) === activeKey);

  if (stats.length === 0) {
    return (
      <div className="rounded-xl border border-(--border) bg-(--bg-secondary) px-4 py-8 text-center text-sm text-(--text-tertiary)">
        No games played yet
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-(--border) bg-(--bg-secondary) p-3 sm:p-4">
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-(--text-secondary)" aria-label="Chart legend">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-green-500" aria-hidden="true" />Wins</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-slate-400" aria-hidden="true" />Draws</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-red-400" aria-hidden="true" />Losses</span>
      </div>
      <ul className="space-y-2">
        {stats.map((stat) => {
          const key = statKey(stat);
          const selected = active !== undefined && key === activeKey;
          return (
            <li key={key}>
              <button
                type="button"
                className="flex min-h-11 w-full flex-col gap-2 rounded-lg p-2 text-left hover:bg-(--bg-tertiary) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-primary)"
                aria-label={details(stat)}
                aria-describedby={selected ? tooltipId : undefined}
                onMouseEnter={() => setActiveKey(key)}
                onMouseLeave={(event) => {
                  if (document.activeElement !== event.currentTarget) setActiveKey(null);
                }}
                onFocus={() => setActiveKey(key)}
                onBlur={() => setActiveKey(null)}
                onClick={() => setActiveKey(key)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setActiveKey(null);
                  }
                }}
              >
                <span className="flex w-full flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="min-w-0 break-words text-sm font-semibold">
                    {stat.name}
                    {stat.eco && <span className="ml-1.5 font-mono text-xs font-normal text-(--text-tertiary)">{stat.eco}</span>}
                  </span>
                  <span className="shrink-0 font-mono text-xs text-(--text-secondary)">{stat.winRate}% wins · {countLabel(stat.total, "game")}</span>
                </span>
                <span className="flex h-3 w-full overflow-hidden rounded-full bg-(--bg-tertiary)" aria-hidden="true">
                  <span className="h-full bg-green-500" style={{ width: `${stat.total ? (stat.wins / stat.total) * 100 : 0}%` }} />
                  <span className="h-full bg-slate-400" style={{ width: `${stat.total ? (stat.draws / stat.total) * 100 : 0}%` }} />
                  <span className="h-full bg-red-400" style={{ width: `${stat.total ? (stat.losses / stat.total) * 100 : 0}%` }} />
                </span>
                <span className="text-xs text-(--text-secondary)">{countLabel(stat.wins, "win")} · {countLabel(stat.draws, "draw")} · {countLabel(stat.losses, "loss")}</span>
              </button>
              {selected && (
                <div id={tooltipId} role="tooltip" className="mx-2 rounded-lg border border-(--border) bg-(--bg) px-3 py-2 text-xs text-(--text-secondary)">
                  {countLabel(stat.total, "game")} · {stat.winRate}% win rate
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
