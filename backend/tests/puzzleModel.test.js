const { dailyPuzzleIndex, utcDateKey } = require("../models/puzzleModel");

describe("daily puzzle selection", () => {
	test("selects the same puzzle index for the same UTC day", () => {
		const key = utcDateKey(new Date("2026-09-25T23:59:59.000Z"));
		expect(key).toBe("2026-09-25");
		expect(dailyPuzzleIndex(key, 25)).toBe(dailyPuzzleIndex(key, 25));
		expect(dailyPuzzleIndex(key, 25)).toBeGreaterThanOrEqual(0);
		expect(dailyPuzzleIndex(key, 25)).toBeLessThan(25);
	});

	test("returns no index for an empty catalog", () => {
		expect(dailyPuzzleIndex("2026-09-25", 0)).toBe(-1);
	});
});
