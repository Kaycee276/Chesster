import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  usePuzzleStreak,
  PUZZLE_STREAK_STORAGE_KEY,
  getUtcDateString,
  getYesterdayUtcDateString,
  getDaysDifference,
  getWeeklyCalendarDays,
} from "../usePuzzleStreak";

describe("usePuzzleStreak Helper Functions", () => {
  it("computes accurate UTC date string regardless of local timezone", () => {
    // 2026-10-16 23:59 UTC
    const date1 = new Date(Date.UTC(2026, 9, 16, 23, 59, 0));
    expect(getUtcDateString(date1)).toBe("2026-10-16");

    // Crossing into next UTC day 2026-10-17 00:01 UTC
    const date2 = new Date(Date.UTC(2026, 9, 17, 0, 1, 0));
    expect(getUtcDateString(date2)).toBe("2026-10-17");
  });

  it("computes yesterday UTC date across month and leap-year boundaries", () => {
    // Standard month boundary (March 1 to Feb 28 on non-leap year 2025)
    expect(getYesterdayUtcDateString("2025-03-01")).toBe("2025-02-28");

    // Leap year boundary (March 1 to Feb 29 on leap year 2024)
    expect(getYesterdayUtcDateString("2024-03-01")).toBe("2024-02-29");

    // Year boundary (Jan 1 to Dec 31)
    expect(getYesterdayUtcDateString("2026-01-01")).toBe("2025-12-31");
  });

  it("calculates difference in days correctly across months and daylight savings", () => {
    expect(getDaysDifference("2026-03-01", "2026-03-02")).toBe(1);
    expect(getDaysDifference("2026-02-28", "2026-03-01")).toBe(1);
    expect(getDaysDifference("2026-01-01", "2026-01-05")).toBe(4);
    expect(getDaysDifference("2026-01-05", "2026-01-01")).toBe(-4);
  });

  it("generates Monday to Sunday weekly calendar with proper flags", () => {
    // 2026-10-16 is a Friday.
    // Week: Monday 2026-10-12 to Sunday 2026-10-18
    const history = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"];
    const days = getWeeklyCalendarDays("2026-10-16", history);

    expect(days).toHaveLength(7);
    expect(days[0]).toMatchObject({
      dayName: "Mo",
      dateStr: "2026-10-12",
      isToday: false,
      isSolved: true,
      isFuture: false,
    });
    expect(days[4]).toMatchObject({
      dayName: "Fr",
      dateStr: "2026-10-16",
      isToday: true,
      isSolved: true,
      isFuture: false,
    });
    expect(days[5]).toMatchObject({
      dayName: "Sa",
      dateStr: "2026-10-17",
      isToday: false,
      isSolved: false,
      isFuture: true,
    });
    expect(days[6]).toMatchObject({
      dayName: "Su",
      dateStr: "2026-10-18",
      isToday: false,
      isSolved: false,
      isFuture: true,
    });
  });

  it("correctly identifies Sunday as the end of the week", () => {
    // 2026-10-18 is Sunday
    const days = getWeeklyCalendarDays("2026-10-18", []);
    expect(days[0].dayName).toBe("Mo");
    expect(days[0].dateStr).toBe("2026-10-12");
    expect(days[6].dayName).toBe("Su");
    expect(days[6].dateStr).toBe("2026-10-18");
    expect(days[6].isToday).toBe(true);
  });
});

describe("usePuzzleStreak Hook", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("initializes with default values when localStorage is empty", () => {
    const { result } = renderHook(() => usePuzzleStreak());
    expect(result.current.currentStreak).toBe(0);
    expect(result.current.longestStreak).toBe(0);
    expect(result.current.lastSolvedDate).toBe("");
    expect(result.current.solvedToday).toBe(false);
    expect(result.current.history).toEqual([]);
  });

  it("records first puzzle solved today and sets streak to 1", () => {
    const today = new Date(Date.UTC(2026, 9, 16));
    const { result } = renderHook(() => usePuzzleStreak(today));

    act(() => {
      const outcome = result.current.recordPuzzleSolved(today);
      expect(outcome.isNewRecord).toBe(true);
      expect(outcome.updatedStreak.currentStreak).toBe(1);
      expect(outcome.updatedStreak.longestStreak).toBe(1);
    });

    expect(result.current.currentStreak).toBe(1);
    expect(result.current.longestStreak).toBe(1);
    expect(result.current.solvedToday).toBe(true);
    expect(result.current.lastSolvedDate).toBe("2026-10-16");
    expect(result.current.history).toContain("2026-10-16");
    expect(result.current.isNewBestStreak).toBe(true);

    const stored = JSON.parse(localStorage.getItem(PUZZLE_STREAK_STORAGE_KEY)!);
    expect(stored.currentStreak).toBe(1);
    expect(stored.lastSolvedDate).toBe("2026-10-16");
  });

  it("does not increment streak on duplicate solves on the same calendar day", () => {
    const today = new Date(Date.UTC(2026, 9, 16));
    const { result } = renderHook(() => usePuzzleStreak(today));

    act(() => {
      result.current.recordPuzzleSolved(today);
    });
    expect(result.current.currentStreak).toBe(1);

    act(() => {
      const outcome = result.current.recordPuzzleSolved(today);
      expect(outcome.isNewRecord).toBe(false);
      expect(outcome.updatedStreak.currentStreak).toBe(1);
    });

    expect(result.current.currentStreak).toBe(1);
    expect(result.current.history.filter((d) => d === "2026-10-16")).toHaveLength(1);
  });

  it("increments streak cleanly on consecutive calendar days", () => {
    // Day 1
    const day1 = new Date(Date.UTC(2026, 9, 16));
    const { result, rerender } = renderHook(({ date }) => usePuzzleStreak(date), {
      initialProps: { date: day1 },
    });

    act(() => {
      result.current.recordPuzzleSolved(day1);
    });
    expect(result.current.currentStreak).toBe(1);

    // Day 2 (Consecutive)
    const day2 = new Date(Date.UTC(2026, 9, 17));
    rerender({ date: day2 });

    expect(result.current.currentStreak).toBe(1);
    expect(result.current.solvedToday).toBe(false);

    act(() => {
      result.current.recordPuzzleSolved(day2);
    });

    expect(result.current.currentStreak).toBe(2);
    expect(result.current.longestStreak).toBe(2);
    expect(result.current.solvedToday).toBe(true);
    expect(result.current.lastSolvedDate).toBe("2026-10-17");
  });

  it("resets streak to 1 if a full calendar day is skipped", () => {
    // Solved on 2026-10-14 (Streak was 5, longest 10)
    const initialData = {
      currentStreak: 5,
      longestStreak: 10,
      lastSolvedDate: "2026-10-14",
      solvedToday: false,
      history: ["2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14"],
    };
    localStorage.setItem(PUZZLE_STREAK_STORAGE_KEY, JSON.stringify(initialData));

    // Player visits on 2026-10-16 (Skipped 2026-10-15)
    const daySkipped = new Date(Date.UTC(2026, 9, 16));
    const { result } = renderHook(() => usePuzzleStreak(daySkipped));

    // Prior streak is evaluated as broken (0 active pending solve)
    expect(result.current.currentStreak).toBe(0);
    expect(result.current.longestStreak).toBe(10);
    expect(result.current.solvedToday).toBe(false);

    // Now player solves a puzzle
    act(() => {
      result.current.recordPuzzleSolved(daySkipped);
    });

    expect(result.current.currentStreak).toBe(1);
    expect(result.current.longestStreak).toBe(10);
    expect(result.current.lastSolvedDate).toBe("2026-10-16");
    expect(result.current.isNewBestStreak).toBe(false);
  });

  it("handles leap year date transition (Feb 28 -> Feb 29 -> Mar 1)", () => {
    // 2024 is a leap year
    const feb28 = new Date(Date.UTC(2024, 1, 28));
    const feb29 = new Date(Date.UTC(2024, 1, 29));
    const mar01 = new Date(Date.UTC(2024, 2, 1));

    const { result, rerender } = renderHook(({ date }) => usePuzzleStreak(date), {
      initialProps: { date: feb28 },
    });

    act(() => {
      result.current.recordPuzzleSolved(feb28);
    });
    expect(result.current.currentStreak).toBe(1);

    rerender({ date: feb29 });
    act(() => {
      result.current.recordPuzzleSolved(feb29);
    });
    expect(result.current.currentStreak).toBe(2);

    rerender({ date: mar01 });
    act(() => {
      result.current.recordPuzzleSolved(mar01);
    });
    expect(result.current.currentStreak).toBe(3);
    expect(result.current.longestStreak).toBe(3);
  });

  it("caps history at most recent 30 days", () => {
    const history35 = Array.from({ length: 35 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 0, i + 1));
      return getUtcDateString(d);
    });

    localStorage.setItem(
      PUZZLE_STREAK_STORAGE_KEY,
      JSON.stringify({
        currentStreak: 35,
        longestStreak: 35,
        lastSolvedDate: "2026-02-04",
        history: history35,
      })
    );

    const feb05 = new Date(Date.UTC(2026, 1, 5));
    const { result } = renderHook(() => usePuzzleStreak(feb05));

    act(() => {
      result.current.recordPuzzleSolved(feb05);
    });

    expect(result.current.history.length).toBe(30);
    expect(result.current.history[result.current.history.length - 1]).toBe("2026-02-05");
  });

  it("allows dismissing the new best streak notification banner", () => {
    const today = new Date(Date.UTC(2026, 9, 16));
    const { result } = renderHook(() => usePuzzleStreak(today));

    act(() => {
      result.current.recordPuzzleSolved(today);
    });
    expect(result.current.isNewBestStreak).toBe(true);

    act(() => {
      result.current.dismissNewBestStreak();
    });
    expect(result.current.isNewBestStreak).toBe(false);
  });
});
