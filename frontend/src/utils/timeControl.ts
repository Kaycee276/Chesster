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
