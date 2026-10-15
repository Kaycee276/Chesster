import { Play, Pause, Cpu, Gauge, Layers } from "lucide-react";

export interface AnalysisVariation {
  multipv: number;
  scoreText: string;
  pv: string[];
}

export interface AnalysisControlBarProps {
  currentDepth: number;
  targetDepth: number;
  nps: number;
  multiPv: number;
  isPaused: boolean;
  variations?: AnalysisVariation[];
  onDepthChange: (depth: number) => void;
  onMultiPvChange: (lines: number) => void;
  onTogglePause: () => void;
}

export type { AnalysisPreferences } from "../utils/analysisPreferences";

export default function AnalysisControlBar({
  currentDepth,
  targetDepth,
  nps,
  multiPv,
  isPaused,
  variations = [],
  onDepthChange,
  onMultiPvChange,
  onTogglePause,
}: AnalysisControlBarProps) {
  const depthPercentage = Math.min(100, Math.max(0, Math.round((currentDepth / targetDepth) * 100)));
  const formattedNps = nps >= 1_000_000
    ? `${(nps / 1_000_000).toFixed(2)} MN/s`
    : `${Math.round(nps / 1000)} kN/s`;

  return (
    <div
      data-testid="analysis-control-bar"
      className="shrink-0 rounded-xl bg-(--bg-secondary) border border-(--border) p-3 flex flex-col gap-3 text-xs"
    >
      {/* Top: Engine State & Gauges */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onTogglePause}
            title={isPaused ? "Resume engine evaluation" : "Pause engine evaluation"}
            aria-label={isPaused ? "Resume engine" : "Pause engine"}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-bold text-xs transition-colors ${
              isPaused
                ? "bg-(--accent-dark) hover:bg-(--accent-primary) text-white"
                : "bg-(--bg) border border-(--border) hover:border-(--accent-primary)/60 text-(--text-secondary) hover:text-(--text)"
            }`}
          >
            {isPaused ? <Play size={13} /> : <Pause size={13} />}
            <span>{isPaused ? "Resume" : "Pause"}</span>
          </button>

          <span className="flex items-center gap-1 text-[11px] text-(--text-tertiary)">
            <Cpu size={12} className="text-(--accent-primary)" />
            Stockfish
          </span>
        </div>

        {/* Depth & NPS Gauges */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 text-[11px] font-mono" title="Nodes per second">
            <Gauge size={12} className="text-(--text-tertiary)" />
            <span className="font-semibold text-(--text)">{formattedNps}</span>
          </div>

          <div className="flex items-center gap-1.5 text-[11px] font-mono">
            <span className="text-(--text-tertiary)">Depth:</span>
            <span className="font-bold text-(--text)">
              {currentDepth}/{targetDepth}
            </span>
          </div>
        </div>
      </div>

      {/* Depth progress meter */}
      <div
        className="w-full h-1.5 rounded-full bg-(--bg) overflow-hidden"
        role="progressbar"
        aria-label="Engine search depth progress"
        aria-valuemin={0}
        aria-valuemax={targetDepth}
        aria-valuenow={currentDepth}
      >
        <div
          className="h-full rounded-full bg-(--accent-primary) transition-all duration-300 ease-out"
          style={{ width: `${depthPercentage}%` }}
        />
      </div>

      {/* Controls: Target Depth Slider & Multi-PV */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-(--border)/60">
        {/* Depth Slider */}
        <div className="flex flex-col gap-1">
          <div className="flex justify-between items-center text-[10px] text-(--text-tertiary) font-semibold uppercase">
            <span>Target Depth</span>
            <span className="font-mono text-xs text-(--text)">{targetDepth}</span>
          </div>
          <input
            type="range"
            min={10}
            max={24}
            step={1}
            value={targetDepth}
            onChange={(e) => onDepthChange(Number(e.target.value))}
            aria-label="Target calculation depth"
            className="w-full accent-(--accent-primary) cursor-pointer"
          />
        </div>

        {/* Multi-PV Selector */}
        <div className="flex flex-col gap-1">
          <div className="flex justify-between items-center text-[10px] text-(--text-tertiary) font-semibold uppercase">
            <span className="flex items-center gap-1">
              <Layers size={10} /> Lines (Multi-PV)
            </span>
            <span className="font-mono text-xs text-(--text)">{multiPv}</span>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {[1, 2, 3].map((lines) => (
              <button
                key={lines}
                type="button"
                onClick={() => onMultiPvChange(lines)}
                className={`py-1 rounded-md text-[11px] font-semibold border transition-all ${
                  multiPv === lines
                    ? "bg-(--accent-primary)/15 border-(--accent-primary) text-(--text) font-bold"
                    : "bg-(--bg) border-(--border) text-(--text-tertiary) hover:text-(--text)"
                }`}
              >
                {lines} {lines === 1 ? "line" : "lines"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Multi-PV principal variations */}
      {variations.length > 0 && !isPaused && (
        <div className="flex flex-col gap-1.5 pt-2 border-t border-(--border)/60">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-(--text-tertiary)">
            Evaluated Variations
          </span>
          <div className="flex flex-col gap-1">
            {variations.map((v) => (
              <div
                key={v.multipv}
                className="flex items-center gap-2 p-1.5 rounded-lg bg-(--bg) border border-(--border)/50 font-mono text-[11px]"
              >
                <span className="px-1.5 py-0.5 rounded bg-(--bg-secondary) text-[9px] font-bold text-(--text-tertiary)">
                  PV{v.multipv}
                </span>
                <span className="font-bold text-(--accent-primary) shrink-0">{v.scoreText}</span>
                <span className="text-(--text-secondary) truncate">{v.pv.slice(0, 6).join(" ")}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
