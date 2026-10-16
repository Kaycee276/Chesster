import { useState, useEffect, useCallback } from "react";

export const PUZZLE_STREAK_STORAGE_KEY = "chesster:puzzle_streak";

export interface PuzzleStreakData {
  currentStreak: number;
  longestStreak: number;
  lastSolvedDate: string; // ISO date 'YYYY-MM-DD' in UTC
  solvedToday: boolean;
  history: string[]; // List of past 30 solved dates
}

export interface DayStatus {
  dayName: string; // "Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"
  dateStr: string; // 'YYYY-MM-DD' in UTC
  isToday: boolean;
  isSolved: boolean;
  isFuture: boolean;
}

/**
 * Returns current UTC date string in 'YYYY-MM-DD' format.
 */
export function getUtcDateString(date: Date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Returns the UTC date string for the previous calendar day ('YYYY-MM-DD').
 */
export function getYesterdayUtcDateString(todayUtcStr: string): string {
  const [year, month, day] = todayUtcStr.split("-").map(Number);
  // Date.UTC months are 0-indexed
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - 1);
  return getUtcDateString(date);
}

/**
 * Calculates calendar days between two UTC date strings ('YYYY-MM-DD').
 * Returns (date2 - date1) in calendar days.
 */
export function getDaysDifference(dateStr1: string, dateStr2: string): number {
  const [y1, m1, d1] = dateStr1.split("-").map(Number);
  const [y2, m2, d2] = dateStr2.split("-").map(Number);
  const ms1 = Date.UTC(y1, m1 - 1, d1);
  const ms2 = Date.UTC(y2, m2 - 1, d2);
  const diffMs = ms2 - ms1;
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Generates Monday-Sunday days of the week containing the given reference UTC date.
 */
export function getWeeklyCalendarDays(
  referenceUtcStr: string,
  history: string[]
): DayStatus[] {
  const [year, month, day] = referenceUtcStr.split("-").map(Number);
  const refDate = new Date(Date.UTC(year, month - 1, day));

  // In JS, getUTCDay(): 0 is Sunday, 1 is Monday ... 6 is Saturday
  const dayOfWeek = refDate.getUTCDay();
  // We want Monday (1) as start of week: Monday delta = 0, Sunday delta = -6
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

  const mondayDate = new Date(Date.UTC(year, month - 1, day));
  mondayDate.setUTCDate(mondayDate.getUTCDate() + diffToMonday);

  const dayNames = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
  const weekDays: DayStatus[] = [];

  for (let i = 0; i < 7; i++) {
    const curDate = new Date(mondayDate.getTime());
    curDate.setUTCDate(curDate.getUTCDate() + i);
    const dateStr = getUtcDateString(curDate);
    const diffFromToday = getDaysDifference(referenceUtcStr, dateStr);

    weekDays.push({
      dayName: dayNames[i],
      dateStr,
      isToday: dateStr === referenceUtcStr,
      isSolved: history.includes(dateStr),
      isFuture: diffFromToday > 0,
    });
  }

  return weekDays;
}

const DEFAULT_STREAK_DATA: PuzzleStreakData = {
  currentStreak: 0,
  longestStreak: 0,
  lastSolvedDate: "",
  solvedToday: false,
  history: [],
};

/**
 * Parses raw JSON storage data with fallback and sanitization.
 */
export function parseStoredStreak(raw: string | null): PuzzleStreakData {
  if (!raw) return { ...DEFAULT_STREAK_DATA };
  try {
    const parsed = JSON.parse(raw);
    const currentStreak = typeof parsed.currentStreak === "number" ? parsed.currentStreak : 0;
    const longestStreak = typeof parsed.longestStreak === "number" ? parsed.longestStreak : 0;
    const lastSolvedDate = typeof parsed.lastSolvedDate === "string" ? parsed.lastSolvedDate : "";
    const history = Array.isArray(parsed.history)
      ? parsed.history.filter((d: unknown): d is string => typeof d === "string")
      : [];

    return {
      currentStreak,
      longestStreak,
      lastSolvedDate,
      solvedToday: false,
      history,
    };
  } catch {
    return { ...DEFAULT_STREAK_DATA };
  }
}

/**
 * Resolves current streak status against today's UTC date.
 * If more than 1 day has elapsed since lastSolvedDate, the active streak resets to 0.
 */
export function evaluateStreakStatus(
  stored: PuzzleStreakData,
  todayUtcStr: string
): PuzzleStreakData {
  if (!stored.lastSolvedDate) {
    return {
      ...stored,
      currentStreak: 0,
      solvedToday: false,
    };
  }

  if (stored.lastSolvedDate === todayUtcStr) {
    return {
      ...stored,
      solvedToday: true,
    };
  }

  const daysSinceLastSolved = getDaysDifference(stored.lastSolvedDate, todayUtcStr);
  if (daysSinceLastSolved === 1) {
    // Solved yesterday, streak remains intact awaiting today's solve
    return {
      ...stored,
      solvedToday: false,
    };
  }

  // Missed at least one full calendar day
  return {
    ...stored,
    currentStreak: 0,
    solvedToday: false,
  };
}

export function usePuzzleStreak(customDate?: Date) {
  const [streakData, setStreakData] = useState<PuzzleStreakData>(() => {
    const todayStr = getUtcDateString(customDate);
    if (typeof window === "undefined" || !window.localStorage) {
      return { ...DEFAULT_STREAK_DATA };
    }
    const raw = window.localStorage.getItem(PUZZLE_STREAK_STORAGE_KEY);
    const parsed = parseStoredStreak(raw);
    return evaluateStreakStatus(parsed, todayStr);
  });

  const [isNewBestStreak, setIsNewBestStreak] = useState(false);

  // Sync / refresh state if date changes or storage changes
  useEffect(() => {
    const todayStr = getUtcDateString(customDate);
    if (typeof window === "undefined" || !window.localStorage) return;

    const raw = window.localStorage.getItem(PUZZLE_STREAK_STORAGE_KEY);
    const parsed = parseStoredStreak(raw);
    const evaluated = evaluateStreakStatus(parsed, todayStr);
    setStreakData(evaluated);
  }, [customDate]);

  /**
   * Called when a puzzle is successfully solved.
   * Updates streak, longest streak, lastSolvedDate, and 30-day history in localStorage.
   */
  const recordPuzzleSolved = useCallback(
    (solveDate: Date = customDate || new Date()): {
      updatedStreak: PuzzleStreakData;
      isNewRecord: boolean;
    } => {
      const todayStr = getUtcDateString(solveDate);

      let currentData = streakData;
      if (typeof window !== "undefined" && window.localStorage) {
        const raw = window.localStorage.getItem(PUZZLE_STREAK_STORAGE_KEY);
        currentData = evaluateStreakStatus(parseStoredStreak(raw), todayStr);
      }

      // 1. If already solved today, keep current streak and history
      if (currentData.lastSolvedDate === todayStr) {
        return { updatedStreak: currentData, isNewRecord: false };
      }

      const yesterdayStr = getYesterdayUtcDateString(todayStr);
      let newCurrentStreak = 1;
      if (currentData.lastSolvedDate === yesterdayStr) {
        newCurrentStreak = currentData.currentStreak + 1;
      } else {
        // Missed yesterday or first time playing
        newCurrentStreak = 1;
      }

      const isNewRecord = newCurrentStreak > currentData.longestStreak;
      const newLongestStreak = Math.max(newCurrentStreak, currentData.longestStreak);

      // Update history: append today if not present, keep most recent 30 days
      const updatedHistory = Array.from(new Set([...currentData.history, todayStr]))
        .sort()
        .slice(-30);

      const updated: PuzzleStreakData = {
        currentStreak: newCurrentStreak,
        longestStreak: newLongestStreak,
        lastSolvedDate: todayStr,
        solvedToday: true,
        history: updatedHistory,
      };

      if (typeof window !== "undefined" && window.localStorage) {
        try {
          window.localStorage.setItem(PUZZLE_STREAK_STORAGE_KEY, JSON.stringify(updated));
        } catch (e) {
          console.error("Failed to persist puzzle streak to localStorage", e);
        }
      }

      setStreakData(updated);
      if (isNewRecord) {
        setIsNewBestStreak(true);
      }

      return { updatedStreak: updated, isNewRecord };
    },
    [customDate, streakData]
  );

  const todayStr = getUtcDateString(customDate);
  const weeklyDays = getWeeklyCalendarDays(todayStr, streakData.history);

  const dismissNewBestStreak = useCallback(() => {
    setIsNewBestStreak(false);
  }, []);

  return {
    ...streakData,
    weeklyDays,
    isNewBestStreak,
    recordPuzzleSolved,
    dismissNewBestStreak,
  };
}
