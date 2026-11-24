import type { CSSProperties } from "react";

export const HIGHLIGHT_PRESETS = {
  emerald: { name: "Emerald Green", color: "#10b981" },
  sapphire: { name: "Sapphire Blue", color: "#3b82f6" },
  ruby: { name: "Ruby Red", color: "#ef4444" },
  amber: { name: "Amber Yellow", color: "#f59e0b" },
  monochrome: { name: "Monochrome Outline", color: "#ffffff" },
} as const;

export type MoveHighlightPreset = keyof typeof HIGHLIGHT_PRESETS;
export type MoveHighlightColor = MoveHighlightPreset | `#${string}`;
export const DEFAULT_MOVE_HIGHLIGHT: MoveHighlightColor = "emerald";
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function isMoveHighlightColor(value: unknown): value is MoveHighlightColor {
  return typeof value === "string" && (
    Object.prototype.hasOwnProperty.call(HIGHLIGHT_PRESETS, value) || HEX_COLOR.test(value)
  );
}

export function normalizeMoveHighlightColor(value: unknown): MoveHighlightColor {
  if (!isMoveHighlightColor(value)) return DEFAULT_MOVE_HIGHLIGHT;
  return value.startsWith("#") ? value.toLowerCase() as MoveHighlightColor : value;
}

export function getMoveHighlightHex(value: MoveHighlightColor): string {
  const normalized = normalizeMoveHighlightColor(value);
  return normalized.startsWith("#") ? normalized : HIGHLIGHT_PRESETS[normalized as MoveHighlightPreset].color;
}

/** Dual black/white outlines keep hint boundaries visible on light and dark squares. */
export function getMoveHighlightStyles(value: MoveHighlightColor): {
  dot: CSSProperties; capture: CSSProperties;
} {
  const choice = normalizeMoveHighlightColor(value);
  const hex = getMoveHighlightHex(choice);
  const rgb = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16)).join(", ");
  const monochrome = choice === "monochrome";
  return {
    dot: {
      backgroundColor: monochrome ? "transparent" : `rgba(${rgb}, 0.75)`,
      border: monochrome ? "2px solid #ffffff" : "none",
      boxShadow: monochrome
        ? "0 0 0 2px #000000, inset 0 0 0 1px #000000"
        : "0 0 0 1px #000000, 0 0 0 2px #ffffff",
      opacity: 1,
    },
    capture: {
      borderColor: monochrome ? "#ffffff" : `rgba(${rgb}, 0.95)`,
      boxShadow: "0 0 0 2px #000000, inset 0 0 0 1px #ffffff",
      opacity: 1,
    },
  };
}
