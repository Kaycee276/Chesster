import { useId } from "react";
import { useThemeStore } from "../store/themeStore";
import {
  HIGHLIGHT_PRESETS, getMoveHighlightHex, getMoveHighlightStyles,
  type MoveHighlightPreset,
} from "../utils/moveHighlights";

export default function MoveHighlightPicker() {
  const customId = useId();
  const choice = useThemeStore((state) => state.moveHighlightColor);
  const setChoice = useThemeStore((state) => state.setMoveHighlightColor);
  return (
    <fieldset className="flex flex-col gap-3" onKeyDown={(event) => event.stopPropagation()}>
      <legend className="mb-2 text-sm font-semibold">Legal move highlights</legend>
      <div className="grid grid-cols-2 gap-2">
        {(Object.keys(HIGHLIGHT_PRESETS) as MoveHighlightPreset[]).map((key) => {
          const preset = HIGHLIGHT_PRESETS[key];
          return (
            <button
              key={key}
              type="button"
              aria-label={`${preset.name} legal move highlights`}
              aria-pressed={choice === key}
              onClick={() => setChoice(key)}
              className={`min-h-11 flex items-center gap-2 rounded-lg border p-2 text-left text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-primary) ${choice === key
                ? "border-(--accent-primary) bg-(--accent-primary)/10"
                : "border-(--border) hover:border-(--accent-primary)/60"}`}
            >
              <span
                aria-hidden="true"
                className="h-4 w-4 shrink-0 rounded-full"
                style={getMoveHighlightStyles(key).dot}
              />
              <span>{preset.name}</span>
            </button>
          );
        })}
      </div>
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={customId} className="text-xs">Custom color</label>
        <input
          id={customId}
          type="color"
          aria-label="Custom legal move highlight color"
          value={getMoveHighlightHex(choice)}
          onChange={(event) => setChoice(event.target.value as `#${string}`)}
          className="h-11 w-14 cursor-pointer rounded border border-(--border) bg-(--bg)"
        />
      </div>
      <p className="text-xs text-(--text-tertiary)" aria-live="polite">
        {choice.startsWith("#") ? "Custom color selected" : "Choose a color or an outline for legal destinations."}
      </p>
    </fieldset>
  );
}
