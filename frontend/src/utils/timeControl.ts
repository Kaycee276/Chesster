export type TimeCategory = "Bullet" | "Blitz" | "Rapid" | "Classical";

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
