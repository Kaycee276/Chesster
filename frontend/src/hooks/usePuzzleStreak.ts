import { useState, useCallback } from "react";

export const STREAK_STORAGE_KEY = "chesster:puzzle_streak";

export interface PuzzleStreakData {
  currentStreak: number;
  longestStreak: number;
  lastSolvedDate: string; // ISO date 'YYYY-MM-DD' in UTC
  solvedToday: boolean;
  history: string[]; // List of past 30 solved dates
}

export interface DayStatus {
  dayLabel: "Mo" | "Tu" | "We" | "Th" | "Fr" | "Sa" | "Su";
  dateStr: string;
  isToday: boolean;
  isSolved: boolean;
  isFuture: boolean;
}

export interface PuzzleStreakReturn {
  streakData: PuzzleStreakData;
  recordSolve: () => { isNewRecord: boolean; currentStreak: number };
  resetStreak: () => void;
  weekDays: DayStatus[];
}

export function formatUtcDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function getYesterdayUtc(date: Date): string {
  const prev = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - 1)
  );
  return formatUtcDate(prev);
}

export function parseStoredStreak(
  raw: string | null,
  now = new Date()
): PuzzleStreakData {
  const defaultData: PuzzleStreakData = {
    currentStreak: 0,
    longestStreak: 0,
    lastSolvedDate: "",
    solvedToday: false,
    history: [],
  };

  if (!raw) return defaultData;

  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return defaultData;

    const currentStreak =
      typeof parsed.currentStreak === "number"
        ? Math.max(0, parsed.currentStreak)
        : 0;
    const longestStreak =
      typeof parsed.longestStreak === "number"
        ? Math.max(0, parsed.longestStreak)
        : 0;
    const lastSolvedDate =
      typeof parsed.lastSolvedDate === "string" ? parsed.lastSolvedDate : "";
    const history = Array.isArray(parsed.history)
      ? (parsed.history.filter((h: unknown): h is string => typeof h === "string"))
      : [];

    const todayStr = formatUtcDate(now);
    const yesterdayStr = getYesterdayUtc(now);

    const solvedToday = lastSolvedDate === todayStr;

    // Check if the streak is still alive:
    // If lastSolvedDate is today or yesterday, streak is active.
    // Otherwise, if player missed yesterday, the active streak lapses to 0.
    let activeStreak = currentStreak;
    if (lastSolvedDate !== todayStr && lastSolvedDate !== yesterdayStr) {
      activeStreak = 0;
    }

    return {
      currentStreak: activeStreak,
      longestStreak: Math.max(longestStreak, activeStreak),
      lastSolvedDate,
      solvedToday,
      history,
    };
  } catch {
    return defaultData;
  }
}

export function computeWeekDays(
  now = new Date(),
  history: string[] = []
): DayStatus[] {
  const labels: Array<"Mo" | "Tu" | "We" | "Th" | "Fr" | "Sa" | "Su"> = [
    "Mo",
    "Tu",
    "We",
    "Th",
    "Fr",
    "Sa",
    "Su",
  ];
  const historySet = new Set(history);
  const todayStr = formatUtcDate(now);

  // UTC Day of week: 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  const utcDay = now.getUTCDay();
  // Monday = 0, ..., Sunday = 6
  const mondayOffset = (utcDay + 6) % 7;

  const mondayDate = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - mondayOffset
    )
  );

  const result: DayStatus[] = [];
  for (let i = 0; i < 7; i++) {
    const dayDate = new Date(
      Date.UTC(
        mondayDate.getUTCFullYear(),
        mondayDate.getUTCMonth(),
        mondayDate.getUTCDate() + i
      )
    );
    const dateStr = formatUtcDate(dayDate);
    const isToday = dateStr === todayStr;
    const isFuture = dateStr > todayStr;
    const isSolved = historySet.has(dateStr);

    result.push({
      dayLabel: labels[i],
      dateStr,
      isToday,
      isSolved,
      isFuture,
    });
  }

  return result;
}

export function usePuzzleStreak(customDate?: Date): PuzzleStreakReturn {
  const [streakData, setStreakData] = useState<PuzzleStreakData>(() => {
    if (typeof window === "undefined") {
      return {
        currentStreak: 0,
        longestStreak: 0,
        lastSolvedDate: "",
        solvedToday: false,
        history: [],
      };
    }
    try {
      const raw = window.localStorage.getItem(STREAK_STORAGE_KEY);
      return parseStoredStreak(raw, customDate);
    } catch {
      return parseStoredStreak(null, customDate);
    }
  });

  const recordSolve = useCallback(() => {
    const now = customDate ?? new Date();
    const todayStr = formatUtcDate(now);
    const yesterdayStr = getYesterdayUtc(now);

    let nextStreak = 1;
    let isNewRecord = false;

    if (streakData.lastSolvedDate === todayStr) {
      nextStreak = streakData.currentStreak;
      isNewRecord = false;
    } else if (streakData.lastSolvedDate === yesterdayStr) {
      nextStreak = streakData.currentStreak + 1;
      isNewRecord = nextStreak > streakData.longestStreak;
    } else {
      nextStreak = 1;
      isNewRecord = nextStreak > streakData.longestStreak;
    }

    const newLongest = Math.max(streakData.longestStreak, nextStreak);
    const newHistory = Array.from(
      new Set([...streakData.history, todayStr])
    ).slice(-30);

    const updated: PuzzleStreakData = {
      currentStreak: nextStreak,
      longestStreak: newLongest,
      lastSolvedDate: todayStr,
      solvedToday: true,
      history: newHistory,
    };

    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(
          STREAK_STORAGE_KEY,
          JSON.stringify(updated)
        );
      }
    } catch {
      /* storage full or quota exceeded */
    }

    setStreakData(updated);

    return {
      isNewRecord,
      currentStreak: nextStreak,
    };
  }, [customDate, streakData]);

  const resetStreak = useCallback(() => {
    const blank: PuzzleStreakData = {
      currentStreak: 0,
      longestStreak: 0,
      lastSolvedDate: "",
      solvedToday: false,
      history: [],
    };
    setStreakData(blank);
    try {
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(STREAK_STORAGE_KEY);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const weekDays = computeWeekDays(
    customDate ?? new Date(),
    streakData.history
  );

  return {
    streakData,
    recordSolve,
    resetStreak,
    weekDays,
  };
}
