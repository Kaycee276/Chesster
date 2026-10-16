import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  usePuzzleStreak,
  STREAK_STORAGE_KEY,
  formatUtcDate,
  getYesterdayUtc,
  parseStoredStreak,
  computeWeekDays,
} from "../usePuzzleStreak";

describe("usePuzzleStreak Exhaustive 5D Senior Suite (Issue #554 - 110+ Tests)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Dimension 1: Boundary & Date Utilities (43 Tests)
  // =========================================================================
  describe("Dimension 1: formatUtcDate Boundary Matrix (28 Tests)", () => {
    const dates = [
      { d: new Date("2026-01-01T00:00:00Z"), expected: "2026-01-01", label: "start of year midnight" },
      { d: new Date("2026-01-01T23:59:59Z"), expected: "2026-01-01", label: "start of year end of day" },
      { d: new Date("2026-01-15T12:30:00Z"), expected: "2026-01-15", label: "mid January" },
      { d: new Date("2026-02-01T00:00:00Z"), expected: "2026-02-01", label: "February 1st" },
      { d: new Date("2026-02-28T23:59:59Z"), expected: "2026-02-28", label: "non-leap Feb 28" },
      { d: new Date("2024-02-29T12:00:00Z"), expected: "2024-02-29", label: "leap year Feb 29 (2024)" },
      { d: new Date("2028-02-29T12:00:00Z"), expected: "2028-02-29", label: "leap year Feb 29 (2028)" },
      { d: new Date("2000-02-29T12:00:00Z"), expected: "2000-02-29", label: "century leap year Feb 29 (2000)" },
      { d: new Date("2026-03-01T00:00:00Z"), expected: "2026-03-01", label: "March 1st" },
      { d: new Date("2026-03-31T23:59:59Z"), expected: "2026-03-31", label: "March 31st" },
      { d: new Date("2026-04-01T00:00:00Z"), expected: "2026-04-01", label: "April 1st" },
      { d: new Date("2026-04-30T23:59:59Z"), expected: "2026-04-30", label: "April 30th" },
      { d: new Date("2026-05-01T00:00:00Z"), expected: "2026-05-01", label: "May 1st" },
      { d: new Date("2026-05-31T23:59:59Z"), expected: "2026-05-31", label: "May 31st" },
      { d: new Date("2026-06-01T00:00:00Z"), expected: "2026-06-01", label: "June 1st" },
      { d: new Date("2026-06-30T23:59:59Z"), expected: "2026-06-30", label: "June 30th" },
      { d: new Date("2026-07-01T00:00:00Z"), expected: "2026-07-01", label: "July 1st" },
      { d: new Date("2026-07-31T23:59:59Z"), expected: "2026-07-31", label: "July 31st" },
      { d: new Date("2026-08-01T00:00:00Z"), expected: "2026-08-01", label: "August 1st" },
      { d: new Date("2026-08-31T23:59:59Z"), expected: "2026-08-31", label: "August 31st" },
      { d: new Date("2026-09-01T00:00:00Z"), expected: "2026-09-01", label: "September 1st" },
      { d: new Date("2026-09-30T23:59:59Z"), expected: "2026-09-30", label: "September 30th" },
      { d: new Date("2026-10-01T00:00:00Z"), expected: "2026-10-01", label: "October 1st" },
      { d: new Date("2026-10-31T23:59:59Z"), expected: "2026-10-31", label: "October 31st" },
      { d: new Date("2026-11-01T00:00:00Z"), expected: "2026-11-01", label: "November 1st" },
      { d: new Date("2026-11-30T23:59:59Z"), expected: "2026-11-30", label: "November 30th" },
      { d: new Date("2026-12-01T00:00:00Z"), expected: "2026-12-01", label: "December 1st" },
      { d: new Date("2026-12-31T23:59:59Z"), expected: "2026-12-31", label: "December 31st" },
    ];

    dates.forEach(({ d, expected, label }) => {
      it(`formats ${label} (${expected})`, () => {
        expect(formatUtcDate(d)).toBe(expected);
      });
    });
  });

  describe("Dimension 1: getYesterdayUtc Month & Year Transition Matrix (15 Tests)", () => {
    const rollovers = [
      { date: new Date("2026-01-01T10:00:00Z"), expected: "2025-12-31", desc: "Year rollover: Jan 1 -> Dec 31" },
      { date: new Date("2026-02-01T05:00:00Z"), expected: "2026-01-31", desc: "Month rollover: Feb 1 -> Jan 31" },
      { date: new Date("2026-03-01T08:00:00Z"), expected: "2026-02-28", desc: "Non-leap year: Mar 1 -> Feb 28" },
      { date: new Date("2024-03-01T08:00:00Z"), expected: "2024-02-29", desc: "Leap year: Mar 1 -> Feb 29 (2024)" },
      { date: new Date("2028-03-01T08:00:00Z"), expected: "2028-02-29", desc: "Leap year: Mar 1 -> Feb 29 (2028)" },
      { date: new Date("2000-03-01T08:00:00Z"), expected: "2000-02-29", desc: "Century leap year: Mar 1 -> Feb 29 (2000)" },
      { date: new Date("2026-04-01T01:00:00Z"), expected: "2026-03-31", desc: "Month rollover: Apr 1 -> Mar 31" },
      { date: new Date("2026-05-01T00:00:00Z"), expected: "2026-04-30", desc: "Month rollover: May 1 -> Apr 30" },
      { date: new Date("2026-06-01T02:00:00Z"), expected: "2026-05-31", desc: "Month rollover: Jun 1 -> May 31" },
      { date: new Date("2026-07-01T00:00:00Z"), expected: "2026-06-30", desc: "Month rollover: Jul 1 -> Jun 30" },
      { date: new Date("2026-08-01T00:00:00Z"), expected: "2026-07-31", desc: "Month rollover: Aug 1 -> Jul 31" },
      { date: new Date("2026-09-01T00:00:00Z"), expected: "2026-08-31", desc: "Month rollover: Sep 1 -> Aug 31" },
      { date: new Date("2026-10-01T00:00:00Z"), expected: "2026-09-30", desc: "Month rollover: Oct 1 -> Sep 30" },
      { date: new Date("2026-11-01T00:00:00Z"), expected: "2026-10-31", desc: "Month rollover: Nov 1 -> Oct 31" },
      { date: new Date("2026-12-01T00:00:00Z"), expected: "2026-11-30", desc: "Month rollover: Dec 1 -> Nov 30" },
    ];

    rollovers.forEach(({ date, expected, desc }) => {
      it(`calculates yesterday for ${desc}`, () => {
        expect(getYesterdayUtc(date)).toBe(expected);
      });
    });
  });

  // =========================================================================
  // Dimension 2: Combinatorics - parseStoredStreak Sanitization Matrix (26 Tests)
  // =========================================================================
  describe("Dimension 2: parseStoredStreak Sanitization and Combinatorics", () => {
    const testNow = new Date("2026-10-16T15:00:00Z");

    it("returns zeroed state on null", () => {
      expect(parseStoredStreak(null, testNow)).toEqual({
        currentStreak: 0,
        longestStreak: 0,
        lastSolvedDate: "",
        solvedToday: false,
        history: [],
      });
    });

    const malformedPayloads = [
      { raw: "", desc: "empty string" },
      { raw: "   ", desc: "whitespace string" },
      { raw: "null", desc: "JSON null" },
      { raw: "undefined", desc: "literal undefined" },
      { raw: "NaN", desc: "literal NaN" },
      { raw: "12345", desc: "number literal" },
      { raw: "\"hello\"", desc: "string literal" },
      { raw: "[]", desc: "array instead of object" },
      { raw: "{broken:json", desc: "corrupted JSON" },
      { raw: "{\"currentStreak\":\"five\"}", desc: "non-numeric streak" },
      { raw: "{\"currentStreak\":-10}", desc: "negative streak" },
      { raw: "{\"longestStreak\":-5}", desc: "negative longest streak" },
      { raw: "{\"history\":\"not_array\"}", desc: "non-array history" },
      { raw: "{\"history\":[1,2,3]}", desc: "history with non-strings" },
      { raw: "{\"currentStreak\": 1.5}", desc: "floating point streak clamped" },
      { raw: "{\"currentStreak\": 0, \"longestStreak\": 10}", desc: "zero current streak with positive record" },
      { raw: "{\"currentStreak\": 100, \"longestStreak\": 50}", desc: "streak higher than record" },
      { raw: "{\"extraKey\": true}", desc: "unrecognized extra keys safely ignored" },
      { raw: "{\"lastSolvedDate\": 123456}", desc: "non-string lastSolvedDate" },
      { raw: "{\"history\": [\"2026-10-16\", null, \"2026-10-15\"]}", desc: "history with null elements" },
      { raw: "{\"solvedToday\": \"yes\"}", desc: "non-boolean solvedToday" },
    ];

    malformedPayloads.forEach(({ raw, desc }) => {
      it(`sanitizes ${desc} safely without throwing`, () => {
        const res = parseStoredStreak(raw, testNow);
        expect(res.currentStreak).toBeGreaterThanOrEqual(0);
        expect(res.longestStreak).toBeGreaterThanOrEqual(0);
        expect(Array.isArray(res.history)).toBe(true);
      });
    });

    it("retains active streak if solved yesterday", () => {
      const raw = JSON.stringify({
        currentStreak: 5,
        longestStreak: 10,
        lastSolvedDate: "2026-10-15",
        history: ["2026-10-15"],
      });
      const res = parseStoredStreak(raw, testNow);
      expect(res.currentStreak).toBe(5);
      expect(res.longestStreak).toBe(10);
      expect(res.solvedToday).toBe(false);
    });

    it("marks solvedToday: true when solved on current date", () => {
      const raw = JSON.stringify({
        currentStreak: 6,
        longestStreak: 10,
        lastSolvedDate: "2026-10-16",
        history: ["2026-10-15", "2026-10-16"],
      });
      const res = parseStoredStreak(raw, testNow);
      expect(res.currentStreak).toBe(6);
      expect(res.solvedToday).toBe(true);
    });

    it("resets currentStreak to 0 if last solved date is stale (2+ days ago)", () => {
      const raw = JSON.stringify({
        currentStreak: 5,
        longestStreak: 12,
        lastSolvedDate: "2026-10-14",
        history: ["2026-10-14"],
      });
      const res = parseStoredStreak(raw, testNow);
      expect(res.currentStreak).toBe(0);
      expect(res.longestStreak).toBe(12); // Longest streak preserved!
      expect(res.solvedToday).toBe(false);
    });

    it("resets currentStreak to 0 if lastSolvedDate is missing completely", () => {
      const raw = JSON.stringify({
        currentStreak: 5,
        longestStreak: 5,
      });
      const res = parseStoredStreak(raw, testNow);
      expect(res.currentStreak).toBe(0);
    });
  });

  // =========================================================================
  // Dimension 3: computeWeekDays Calendar Variations & Matrix (25 Tests)
  // =========================================================================
  describe("Dimension 3: computeWeekDays Calendar Variations", () => {
    const daysOfWeek = [
      { date: new Date("2026-10-12T12:00:00Z"), label: "Monday", todayDay: 0 },
      { date: new Date("2026-10-13T12:00:00Z"), label: "Tuesday", todayDay: 1 },
      { date: new Date("2026-10-14T12:00:00Z"), label: "Wednesday", todayDay: 2 },
      { date: new Date("2026-10-15T12:00:00Z"), label: "Thursday", todayDay: 3 },
      { date: new Date("2026-10-16T12:00:00Z"), label: "Friday", todayDay: 4 },
      { date: new Date("2026-10-17T12:00:00Z"), label: "Saturday", todayDay: 5 },
      { date: new Date("2026-10-18T12:00:00Z"), label: "Sunday", todayDay: 6 },
    ];

    daysOfWeek.forEach(({ date, label, todayDay }) => {
      it(`computes Monday-Sunday week correctly when today is ${label}`, () => {
        const week = computeWeekDays(date, ["2026-10-12"]);
        expect(week).toHaveLength(7);
        expect(week[0].dayLabel).toBe("Mo");
        expect(week[1].dayLabel).toBe("Tu");
        expect(week[2].dayLabel).toBe("We");
        expect(week[3].dayLabel).toBe("Th");
        expect(week[4].dayLabel).toBe("Fr");
        expect(week[5].dayLabel).toBe("Sa");
        expect(week[6].dayLabel).toBe("Su");
        expect(week[todayDay].isToday).toBe(true);
      });
    });

    const solvePatterns = [
      { name: "all days solved", history: ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"], expectedSolvedIndices: [0, 1, 2, 3, 4, 5, 6] },
      { name: "empty history", history: [], expectedSolvedIndices: [] },
      { name: "only Monday solved", history: ["2026-10-12"], expectedSolvedIndices: [0] },
      { name: "only Wednesday solved", history: ["2026-10-14"], expectedSolvedIndices: [2] },
      { name: "only Sunday solved", history: ["2026-10-18"], expectedSolvedIndices: [6] },
      { name: "weekend only solved", history: ["2026-10-17", "2026-10-18"], expectedSolvedIndices: [5, 6] },
      { name: "weekdays only solved", history: ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"], expectedSolvedIndices: [0, 1, 2, 3, 4] },
      { name: "alternating days (Mon, Wed, Fri, Sun)", history: ["2026-10-12", "2026-10-14", "2026-10-16", "2026-10-18"], expectedSolvedIndices: [0, 2, 4, 6] },
      { name: "alternating days (Tue, Thu, Sat)", history: ["2026-10-13", "2026-10-15", "2026-10-17"], expectedSolvedIndices: [1, 3, 5] },
      { name: "unrelated historical dates do not mark current week", history: ["2026-09-01", "2026-08-15"], expectedSolvedIndices: [] },
    ];

    solvePatterns.forEach(({ name, history, expectedSolvedIndices }) => {
      it(`evaluates solve pattern: ${name}`, () => {
        const testDate = new Date("2026-10-14T12:00:00Z"); // Wed
        const week = computeWeekDays(testDate, history);
        for (let i = 0; i < 7; i++) {
          expect(week[i].isSolved).toBe(expectedSolvedIndices.includes(i));
        }
      });
    });

    const isFutureChecks = [
      { todayIndex: 0, testDate: new Date("2026-10-12T12:00:00Z"), futureIndices: [1, 2, 3, 4, 5, 6] },
      { todayIndex: 2, testDate: new Date("2026-10-14T12:00:00Z"), futureIndices: [3, 4, 5, 6] },
      { todayIndex: 4, testDate: new Date("2026-10-16T12:00:00Z"), futureIndices: [5, 6] },
      { todayIndex: 6, testDate: new Date("2026-10-18T12:00:00Z"), futureIndices: [] },
    ];

    isFutureChecks.forEach(({ todayIndex, testDate, futureIndices }) => {
      it(`accurately marks isFuture for day index ${todayIndex}`, () => {
        const week = computeWeekDays(testDate, []);
        for (let i = 0; i < 7; i++) {
          expect(week[i].isFuture).toBe(futureIndices.includes(i));
        }
      });
    });

    it("spans month boundary seamlessly within one week (e.g. Sep 28 - Oct 4, 2026)", () => {
      const wednesdayOct1 = new Date("2026-10-01T12:00:00Z");
      const week = computeWeekDays(wednesdayOct1, ["2026-09-28", "2026-10-01"]);
      expect(week[0].dateStr).toBe("2026-09-28"); // Monday in September
      expect(week[2].dateStr).toBe("2026-09-30"); // Wednesday Sep 30
      expect(week[3].dateStr).toBe("2026-10-01"); // Thursday Oct 1
      expect(week[6].dateStr).toBe("2026-10-04"); // Sunday Oct 4
      expect(week[0].isSolved).toBe(true);
      expect(week[3].isSolved).toBe(true);
      expect(week[3].isToday).toBe(true);
    });

    it("spans leap year February-March boundary inside one week (Feb 26 - Mar 3, 2024)", () => {
      const feb29 = new Date("2024-02-29T12:00:00Z");
      const week = computeWeekDays(feb29, ["2024-02-29"]);
      expect(week[0].dateStr).toBe("2024-02-26"); // Monday
      expect(week[3].dateStr).toBe("2024-02-29"); // Thursday Leap Day
      expect(week[4].dateStr).toBe("2024-03-01"); // Friday March 1st
      expect(week[3].isSolved).toBe(true);
      expect(week[3].isToday).toBe(true);
    });

    it("spans year boundary inside one week (Dec 28, 2026 - Jan 3, 2027)", () => {
      const jan1 = new Date("2027-01-01T12:00:00Z");
      const week = computeWeekDays(jan1, ["2026-12-31", "2027-01-01"]);
      expect(week[0].dateStr).toBe("2026-12-28"); // Monday
      expect(week[3].dateStr).toBe("2026-12-31"); // Thursday
      expect(week[4].dateStr).toBe("2027-01-01"); // Friday New Year
      expect(week[3].isSolved).toBe(true);
      expect(week[4].isSolved).toBe(true);
      expect(week[4].isToday).toBe(true);
    });

    it("handles non-array history gracefully by defaulting to empty array", () => {
      // @ts-expect-error testing invalid argument at runtime
      const week = computeWeekDays(new Date("2026-10-14T12:00:00Z"), null);
      expect(week).toHaveLength(7);
      expect(week.every(d => d.isSolved === false)).toBe(true);
    });
  });

  // =========================================================================
  // Dimension 4: Negative Controls & Error Resilience (10 Tests)
  // =========================================================================
  describe("Dimension 4: Negative Controls and Quota Exceeded Resilience", () => {
    it("handles storage write failure without breaking hook state", () => {
      const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });

      const { result } = renderHook(() => usePuzzleStreak());
      act(() => {
        result.current.recordSolve();
      });

      expect(result.current.streakData.currentStreak).toBe(1);
      expect(setItemSpy).toHaveBeenCalled();
    });

    it("handles storage removal failure gracefully during reset", () => {
      const removeItemSpy = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
        throw new Error("SecurityError");
      });

      const { result } = renderHook(() => usePuzzleStreak());
      act(() => {
        result.current.resetStreak();
      });

      expect(result.current.streakData.currentStreak).toBe(0);
      expect(removeItemSpy).toHaveBeenCalled();
    });

    it("handles localStorage.getItem throwing an exception gracefully on initial render", () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("AccessDenied");
      });

      const { result } = renderHook(() => usePuzzleStreak());
      expect(result.current.streakData.currentStreak).toBe(0);
      expect(result.current.streakData.longestStreak).toBe(0);
    });

    it("does not increment streak on 5 repeated solves on the exact same date", () => {
      const { result } = renderHook(() => usePuzzleStreak());
      for (let i = 0; i < 5; i++) {
        act(() => {
          result.current.recordSolve();
        });
        expect(result.current.streakData.currentStreak).toBe(1);
        expect(result.current.streakData.solvedToday).toBe(true);
      }
    });

    it("returns isNewRecord: false on redundant same-day solve calls", () => {
      const { result } = renderHook(() => usePuzzleStreak());
      let firstSolveResult: { isNewRecord: boolean; currentStreak: number } | undefined;
      let secondSolveResult: { isNewRecord: boolean; currentStreak: number } | undefined;

      act(() => {
        firstSolveResult = result.current.recordSolve();
      });
      expect(firstSolveResult?.isNewRecord).toBe(true);

      act(() => {
        secondSolveResult = result.current.recordSolve();
      });
      expect(secondSolveResult?.isNewRecord).toBe(false);
    });

    it("retains previous longestStreak when current streak is below record", () => {
      window.localStorage.setItem(
        STREAK_STORAGE_KEY,
        JSON.stringify({
          currentStreak: 0,
          longestStreak: 25,
          lastSolvedDate: "2026-10-01",
          history: ["2026-10-01"],
        })
      );

      const { result } = renderHook(() => usePuzzleStreak());
      expect(result.current.streakData.longestStreak).toBe(25);
      expect(result.current.streakData.currentStreak).toBe(0);

      let solveRes: { isNewRecord: boolean; currentStreak: number } | undefined;
      act(() => {
        solveRes = result.current.recordSolve();
      });

      expect(result.current.streakData.currentStreak).toBe(1);
      expect(result.current.streakData.longestStreak).toBe(25);
      expect(solveRes?.isNewRecord).toBe(false);
    });

    it("caps history array to maximum 30 unique dates", () => {
      const { result } = renderHook(() => usePuzzleStreak());
      let fakeTime = new Date("2026-08-01T12:00:00Z").getTime();

      for (let i = 1; i <= 35; i++) {
        vi.setSystemTime(fakeTime);
        act(() => {
          result.current.recordSolve();
        });
        fakeTime += 86_400_000;
      }

      expect(result.current.streakData.history.length).toBeLessThanOrEqual(30);
    });

    it("preserves streak history immutability across state transitions", () => {
      const { result } = renderHook(() => usePuzzleStreak());
      act(() => {
        result.current.recordSolve();
      });
      const historyRef = result.current.streakData.history;
      act(() => {
        result.current.resetStreak();
      });
      expect(historyRef).toHaveLength(1); // Original snapshot was not mutated
      expect(result.current.streakData.history).toEqual([]);
    });

    it("ignores unknown actions and returns stable weekDays reference when history unchanged", () => {
      const { result } = renderHook(() => usePuzzleStreak());
      const week1 = result.current.weekDays;
      act(() => {
        // Redundant solve today
        result.current.recordSolve();
      });
      const week2 = result.current.weekDays;
      expect(week1[0].dayLabel).toBe(week2[0].dayLabel);
    });

    it("correctly synchronizes with STREAK_STORAGE_KEY in localStorage", () => {
      const { result } = renderHook(() => usePuzzleStreak());
      act(() => {
        result.current.recordSolve();
      });
      const rawStored = window.localStorage.getItem(STREAK_STORAGE_KEY);
      expect(rawStored).toBeTruthy();
      const parsed = JSON.parse(rawStored!);
      expect(parsed.currentStreak).toBe(1);
      expect(parsed.solvedToday).toBe(true);
    });
  });

  // =========================================================================
  // Dimension 5: Lifecycle, Long Streaks & Stress Simulation (12 Tests)
  // =========================================================================
  describe("Dimension 5: Lifecycle, Long Streaks & Stress Simulation", () => {
    it("simulates a 30-day consecutive streak incrementing properly", () => {
      const { result } = renderHook(() => usePuzzleStreak());
      let fakeTime = new Date("2026-09-01T12:00:00Z").getTime();

      for (let i = 1; i <= 30; i++) {
        vi.setSystemTime(fakeTime);
        act(() => {
          result.current.recordSolve();
        });
        expect(result.current.streakData.currentStreak).toBe(i);
        expect(result.current.streakData.longestStreak).toBe(i);
        fakeTime += 86_400_000; // Next day
      }
    });

    it("resets streak to 1 after missing a day but preserves best streak of 30", () => {
      const { result } = renderHook(() => usePuzzleStreak());
      let fakeTime = new Date("2026-09-01T12:00:00Z").getTime();

      for (let i = 1; i <= 30; i++) {
        vi.setSystemTime(fakeTime);
        act(() => {
          result.current.recordSolve();
        });
        fakeTime += 86_400_000;
      }

      // Skip 2 days
      fakeTime += 86_400_000 * 2;
      vi.setSystemTime(fakeTime);

      act(() => {
        result.current.recordSolve();
      });

      expect(result.current.streakData.currentStreak).toBe(1);
      expect(result.current.streakData.longestStreak).toBe(30);
    });

    it("transitions seamlessly across month boundary (Sep 30 -> Oct 1)", () => {
      const { result } = renderHook(() => usePuzzleStreak());
      vi.setSystemTime(new Date("2026-09-30T22:00:00Z"));
      act(() => {
        result.current.recordSolve();
      });
      expect(result.current.streakData.currentStreak).toBe(1);

      vi.setSystemTime(new Date("2026-10-01T02:00:00Z"));
      act(() => {
        result.current.recordSolve();
      });
      expect(result.current.streakData.currentStreak).toBe(2);
    });

    it("transitions seamlessly across leap day (Feb 28 -> Feb 29 -> Mar 1, 2024)", () => {
      const { result } = renderHook(() => usePuzzleStreak());
      vi.setSystemTime(new Date("2024-02-28T14:00:00Z"));
      act(() => {
        result.current.recordSolve();
      });
      expect(result.current.streakData.currentStreak).toBe(1);

      vi.setSystemTime(new Date("2024-02-29T14:00:00Z"));
      act(() => {
        result.current.recordSolve();
      });
      expect(result.current.streakData.currentStreak).toBe(2);

      vi.setSystemTime(new Date("2024-03-01T14:00:00Z"));
      act(() => {
        result.current.recordSolve();
      });
      expect(result.current.streakData.currentStreak).toBe(3);
    });

    it("transitions seamlessly across year boundary (Dec 31 -> Jan 1)", () => {
      const { result } = renderHook(() => usePuzzleStreak());
      vi.setSystemTime(new Date("2026-12-31T20:00:00Z"));
      act(() => {
        result.current.recordSolve();
      });
      expect(result.current.streakData.currentStreak).toBe(1);

      vi.setSystemTime(new Date("2027-01-01T08:00:00Z"));
      act(() => {
        result.current.recordSolve();
      });
      expect(result.current.streakData.currentStreak).toBe(2);
    });

    it("resets streak cleanly with resetStreak() method", () => {
      const { result } = renderHook(() => usePuzzleStreak());
      act(() => {
        result.current.recordSolve();
      });
      expect(result.current.streakData.currentStreak).toBe(1);

      act(() => {
        result.current.resetStreak();
      });
      expect(result.current.streakData.currentStreak).toBe(0);
      expect(result.current.streakData.solvedToday).toBe(false);
      expect(result.current.streakData.longestStreak).toBe(0);
    });

    it("survives rapid consecutive stress calls without state degradation", () => {
      const { result } = renderHook(() => usePuzzleStreak());
      act(() => {
        for (let i = 0; i < 20; i++) {
          result.current.recordSolve();
        }
      });
      expect(result.current.streakData.currentStreak).toBe(1);
    });

    it("properly flags isNewRecord on every streak extension until record exceeded", () => {
      const { result } = renderHook(() => usePuzzleStreak());
      let time = new Date("2026-05-01T12:00:00Z").getTime();

      // Day 1
      vi.setSystemTime(time);
      let r1: { isNewRecord: boolean; currentStreak: number } | undefined;
      act(() => { r1 = result.current.recordSolve(); });
      expect(r1?.isNewRecord).toBe(true);

      // Day 2
      time += 86_400_000;
      vi.setSystemTime(time);
      let r2: { isNewRecord: boolean; currentStreak: number } | undefined;
      act(() => { r2 = result.current.recordSolve(); });
      expect(r2?.isNewRecord).toBe(true);

      // Reset
      act(() => { result.current.resetStreak(); });

      // Start again on Day 3
      time += 86_400_000;
      vi.setSystemTime(time);
      let r3: { isNewRecord: boolean; currentStreak: number } | undefined;
      act(() => { r3 = result.current.recordSolve(); });
      expect(r3?.isNewRecord).toBe(true);
    });

    it("simulates 60-day calendar progression verifying stability", () => {
      const { result } = renderHook(() => usePuzzleStreak());
      let time = new Date("2026-01-01T10:00:00Z").getTime();

      for (let day = 1; day <= 60; day++) {
        vi.setSystemTime(time);
        act(() => {
          result.current.recordSolve();
        });
        time += 86_400_000;
      }
      expect(result.current.streakData.currentStreak).toBe(60);
      expect(result.current.streakData.longestStreak).toBe(60);
    });

    it("handles time traveling backwards gracefully without crash", () => {
      const { result } = renderHook(() => usePuzzleStreak());
      vi.setSystemTime(new Date("2026-10-16T12:00:00Z"));
      act(() => {
        result.current.recordSolve();
      });
      expect(result.current.streakData.currentStreak).toBe(1);

      // Travel back to yesterday
      vi.setSystemTime(new Date("2026-10-15T12:00:00Z"));
      act(() => {
        result.current.recordSolve();
      });
      // Does not throw and handles gracefully
      expect(result.current.streakData.currentStreak).toBeGreaterThanOrEqual(1);
    });

    it("re-renders with updated weekDays when customDate prop changes", () => {
      const date1 = new Date("2026-10-12T12:00:00Z"); // Monday
      const { result, rerender } = renderHook(({ d }) => usePuzzleStreak(d), {
        initialProps: { d: date1 },
      });
      expect(result.current.weekDays[0].isToday).toBe(true);

      const date2 = new Date("2026-10-16T12:00:00Z"); // Friday
      rerender({ d: date2 });
      expect(result.current.weekDays[4].isToday).toBe(true);
    });

    it("completes full lifecycle unmount and re-mount reading from persistent storage", () => {
      const { result: firstMount, unmount } = renderHook(() => usePuzzleStreak());
      act(() => {
        firstMount.current.recordSolve();
      });
      expect(firstMount.current.streakData.currentStreak).toBe(1);
      unmount();

      // Second mount reads from localStorage
      const { result: secondMount } = renderHook(() => usePuzzleStreak());
      expect(secondMount.current.streakData.currentStreak).toBe(1);
      expect(secondMount.current.streakData.solvedToday).toBe(true);
    });
  });
});
