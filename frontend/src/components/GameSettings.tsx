import { useState } from "react";
import { Settings, Volume2 } from "lucide-react";
import { useGameStore } from "../store/gameStore";
import { BOARD_THEMES, useThemeStore } from "../store/themeStore";
import { soundService } from "../services/soundService";

export default function GameSettings({ hideFloating = false }: { hideFloating?: boolean } = {}) {
  const isBlindfoldMode = useGameStore((s) => s.isBlindfoldMode);
  const toggleBlindfoldMode = useGameStore((s) => s.toggleBlindfoldMode);
  const blindfoldMode = useGameStore((s) => s.blindfoldMode);
  const setBlindfoldMode = useGameStore((s) => s.setBlindfoldMode);
  const isStreamerMode = useGameStore((s) => s.isStreamerMode);
  const toggleStreamerMode = useGameStore((s) => s.toggleStreamerMode);
  const isHapticsEnabled = useGameStore((s) => s.isHapticsEnabled);
  const toggleHaptics = useGameStore((s) => s.toggleHaptics);
  const isMoveConfirmationEnabled = useGameStore((s) => s.isMoveConfirmationEnabled);
  const toggleMoveConfirmation = useGameStore((s) => s.toggleMoveConfirmation);
  const masterVolume = useGameStore((s) => s.masterVolume);
  const setMasterVolume = useGameStore((s) => s.setMasterVolume);
  const pieceSet = useGameStore((s) => s.pieceSet);
  const setPieceSet = useGameStore((s) => s.setPieceSet);
  const boardTheme = useThemeStore((s) => s.boardTheme);
  const setBoardTheme = useThemeStore((s) => s.setBoardTheme);
  const isSettingsOpen = useGameStore((s) => s.isSettingsOpen);
  const setSettingsOpen = useGameStore((s) => s.setSettingsOpen);
  const [localOpen, setLocalOpen] = useState(false);

  const open = isSettingsOpen || localOpen;
  const setOpen = (val: boolean) => {
    setLocalOpen(val);
    setSettingsOpen(val);
  };

  let isGameRoute = false;
  if (typeof window !== "undefined" && window.location) {
    const p = window.location.pathname;
    isGameRoute =
      p.startsWith("/overlay") ||
      p.startsWith("/spectate") ||
      (p !== "/" &&
        ![
          "/tournaments",
          "/puzzles",
          "/referrals",
          "/leaderboard",
          "/analysis",
          "/status",
        ].includes(p) &&
        !p.startsWith("/profile") &&
        !p.startsWith("/tournaments/"));
  }
  const showFloating = !hideFloating && !isGameRoute;

  return (
    <>
      {/* Floating trigger button */}
      {showFloating && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Game settings"
          aria-label="Open game settings"
          className="hidden md:flex fixed bottom-20 right-4 z-40 items-center justify-center w-10 h-10 rounded-full bg-(--bg-secondary) border border-(--border) text-(--text-secondary) hover:text-(--text) shadow-lg hover:border-(--accent-primary)/60 transition-colors"
        >
          <Settings size={16} />
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm bg-(--bg-secondary) border border-(--border) rounded-2xl p-5 sm:p-6 flex flex-col gap-5 shadow-2xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold flex items-center gap-2">
                <Settings size={16} className="text-(--accent-primary)" />
                Game Settings
              </h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-(--text-tertiary) hover:text-(--text) transition-colors text-lg leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="flex flex-col gap-3 border-t border-(--border) pt-3">
              <div className="flex items-center justify-between">
                <label htmlFor="master-volume" className="flex items-center gap-2 text-sm font-semibold">
                  <Volume2 size={16} /> Master volume
                </label>
                <output htmlFor="master-volume" className="text-xs text-(--text-tertiary)">
                  {Math.round(masterVolume * 100)}%
                </output>
              </div>
              <input
                id="master-volume"
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={masterVolume}
                onChange={(event) => {
                  const volume = Number(event.target.value);
                  setMasterVolume(volume);
                  soundService.move();
                }}
                aria-label="Master volume"
                className="w-full accent-(--accent-primary)"
              />
            </div>

            <div className="flex flex-col gap-3 border-t border-(--border) pt-3">
              <span className="text-sm font-semibold">Board theme</span>
              <div className="grid grid-cols-2 gap-2">
                {BOARD_THEMES.map((theme) => (
                  <button
                    key={theme.key}
                    type="button"
                    onClick={() => setBoardTheme(theme.key)}
                    aria-label={`Select ${theme.name} board theme`}
                    aria-pressed={boardTheme === theme.key}
                    className={`flex items-center gap-2 rounded-lg border p-2 text-left text-xs transition-colors ${
                      boardTheme === theme.key
                        ? "border-(--accent-primary) ring-2 ring-(--accent-primary)/40"
                        : "border-(--border) hover:border-(--accent-primary)/60"
                    }`}
                  >
                    <span className="grid h-7 w-7 grid-cols-2 grid-rows-2 overflow-hidden rounded-sm border border-black/20" aria-hidden="true">
                      <span style={{ backgroundColor: theme.light }} />
                      <span style={{ backgroundColor: theme.dark }} />
                      <span style={{ backgroundColor: theme.dark }} />
                      <span style={{ backgroundColor: theme.light }} />
                    </span>
                    <span>{theme.name}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t border-(--border) pt-3">
              <span className="text-sm font-semibold">Piece set</span>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { key: "classic" as const, name: "Classic", symbol: "♔" },
                  { key: "neo" as const, name: "Neo", symbol: "♔" },
                  { key: "wood" as const, name: "Wood", symbol: "♔" },
                ].map((set) => (
                  <button
                    key={set.key}
                    type="button"
                    onClick={() => setPieceSet(set.key)}
                    aria-label={`Select ${set.name} piece set`}
                    aria-pressed={pieceSet === set.key}
                    className={`flex flex-col items-center justify-center gap-1 rounded-lg border p-3 text-center text-xs transition-colors ${
                      pieceSet === set.key
                        ? "border-(--accent-primary) ring-2 ring-(--accent-primary)/40 bg-(--bg-tertiary)"
                        : "border-(--border) hover:border-(--accent-primary)/60"
                    }`}
                  >
                    <span className="text-2xl leading-none">{set.symbol}</span>
                    <span className="font-semibold text-xs">{set.name}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Blindfold Mode Toggle & Options */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-semibold">Blindfold Mode</label>
                  <p className="text-xs text-(--text-tertiary)">
                    Hide piece positions to train calculation
                  </p>
                </div>
                <button
                  type="button"
                  onClick={toggleBlindfoldMode}
                  className={`relative flex h-6 w-11 rounded-full transition-colors ${
                    isBlindfoldMode ? "bg-(--accent-primary)" : "bg-(--bg-tertiary)"
                  }`}
                  role="switch"
                  aria-checked={isBlindfoldMode}
                  aria-label="Toggle blindfold mode"
                >
                  <div
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-md transition-transform ${
                      isBlindfoldMode ? "translate-x-5" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>

              {/* Progressive Blindfold Radio Options */}
              <div className="grid grid-cols-2 gap-2 pt-1" role="radiogroup" aria-label="Blindfold Mode Options">
                {[
                  { value: "none", label: "Visible (None)" },
                  { value: "white", label: "Hide White" },
                  { value: "black", label: "Hide Black" },
                  { value: "all", label: "Hide All" },
                ].map((opt) => (
                  <label
                    key={opt.value}
                    className={`flex items-center gap-2 p-2 rounded-lg border text-xs cursor-pointer transition-colors ${
                      blindfoldMode === opt.value
                        ? "border-(--accent-primary) bg-(--accent-primary)/10 text-(--text)"
                        : "border-(--border) hover:bg-(--bg-tertiary) text-(--text-secondary)"
                    }`}
                  >
                    <input
                      type="radio"
                      name="blindfoldMode"
                      value={opt.value}
                      checked={blindfoldMode === opt.value}
                      onChange={() => setBlindfoldMode(opt.value as "none" | "white" | "black" | "all")}
                      className="accent-(--accent-primary)"
                    />
                    <span>{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <p className="text-xs text-(--text-secondary) leading-relaxed">
              Configure partial blindfold (hide white or black pieces) or full blindfold.
              When hidden, pieces appear as subtle markers. Use the peek button to reveal pieces.
            </p>

            {/* Streamer Mode Toggle */}
            <div className="flex flex-col gap-3 pt-3 border-t border-(--border)">
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-semibold">Streamer Mode</label>
                  <p className="text-xs text-(--text-tertiary)">
                    Mask wallet addresses, balances, and wagers for live streaming
                  </p>
                </div>
                <button
                  type="button"
                  onClick={toggleStreamerMode}
                  className={`relative flex h-6 w-11 rounded-full transition-colors ${
                    isStreamerMode ? "bg-(--accent-primary)" : "bg-(--bg-tertiary)"
                  }`}
                  role="switch"
                  aria-checked={isStreamerMode}
                  aria-label="Toggle streamer mode"
                >
                  <div
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-md transition-transform ${
                      isStreamerMode ? "translate-x-5" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>
            </div>

            {/* Haptic Feedback Toggle (#439) */}
            <div className="flex flex-col gap-3 pt-3 border-t border-(--border)">
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-semibold">Haptic Feedback</label>
                  <p className="text-xs text-(--text-tertiary)">
                    Subtle vibration on piece pickup, valid drops, and illegal moves
                  </p>
                </div>
                <button
                  type="button"
                  onClick={toggleHaptics}
                  className={`relative flex h-6 w-11 rounded-full transition-colors ${
                    isHapticsEnabled ? "bg-(--accent-primary)" : "bg-(--bg-tertiary)"
                  }`}
                  role="switch"
                  aria-checked={isHapticsEnabled}
                  aria-label="Toggle haptic feedback"
                >
                  <div
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-md transition-transform ${
                      isHapticsEnabled ? "translate-x-5" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>
            </div>

            {/* Move Confirmation Toggle (#493) */}
            <div className="flex flex-col gap-3 pt-3 border-t border-(--border)">
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-semibold">Move Confirmation</label>
                  <p className="text-xs text-(--text-tertiary)">
                    Require confirmation before committing moves in high-stakes games
                  </p>
                </div>
                <button
                  type="button"
                  onClick={toggleMoveConfirmation}
                  className={`relative flex h-6 w-11 rounded-full transition-colors ${
                    isMoveConfirmationEnabled ? "bg-(--accent-primary)" : "bg-(--bg-tertiary)"
                  }`}
                  role="switch"
                  aria-checked={isMoveConfirmationEnabled}
                  aria-label="Toggle move confirmation"
                >
                  <div
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-md transition-transform ${
                      isMoveConfirmationEnabled ? "translate-x-5" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
