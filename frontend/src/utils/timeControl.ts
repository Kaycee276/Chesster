export type TimeCategory = "Bullet" | "Blitz" | "Rapid" | "Classical";

export function formatTime(totalMs: number): string {
  const safeMs = Number.isFinite(totalMs) ? Math.max(0, totalMs) : 0;

  if (safeMs < 10_000) {
    const seconds = Math.floor(safeMs / 1000);
    const tenths = Math.floor((safeMs % 1000) / 100);
    return `0:0${seconds}.${tenths}`;
  }

  const totalSeconds = Math.ceil(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function getTimeCategory(baseMinutes: number, incrementSeconds: number): TimeCategory {
  const totalMinutes = baseMinutes + (incrementSeconds * 40) / 60;
  if (totalMinutes < 3) return "Bullet";
  if (totalMinutes < 10) return "Blitz";
  if (totalMinutes < 60) return "Rapid";
  return "Classical";
}

export function isValidTimeControl(baseMinutes: number, incrementSeconds: number): boolean {
  return (
    Number.isInteger(baseMinutes) &&
    baseMinutes >= 1 &&
    baseMinutes <= 60 &&
    Number.isInteger(incrementSeconds) &&
    incrementSeconds >= 0 &&
    incrementSeconds <= 30
  );
}

/** Remaining-seconds marks that trigger a screen reader announcement (#646), descending. */
export const ANNOUNCE_THRESHOLDS = [30, 10, 5] as const;

function plural(count: number, unit: string): string {
	return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/** Natural-language duration for screen readers, e.g. "1 minute 45 seconds". */
export function describeDuration(ms: number): string {
	const total = Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / 1000)) : 0;
	const minutes = Math.floor(total / 60);
	const seconds = total % 60;
	if (minutes === 0) return plural(seconds, "second");
	if (seconds === 0) return plural(minutes, "minute");
	return `${plural(minutes, "minute")} ${plural(seconds, "second")}`;
}

/**
 * The tightest announcement threshold the clock is currently at or under, or
 * null when above all of them. Derived from the remaining time rather than
 * from tick events, so a clock update that skips an exact second still lands
 * in the right bucket and re-renders within a bucket do not re-announce.
 */
export function announcementThreshold(ms: number): number | null {
	const seconds = Math.ceil(Math.max(0, ms) / 1000);
	let found: number | null = null;
	for (const t of ANNOUNCE_THRESHOLDS) if (seconds <= t) found = t;
	return found;
}
