import { describe, expect, it } from "vitest";
import {
  calculateNewRating,
  calculateRatingPeriod,
  DEFAULT_PUZZLE_RATING,
} from "./glickoCalculator";

describe("Glicko 2 puzzle ratings", () => {
  it("matches the published Glickman worked example", () => {
    const next = calculateRatingPeriod({ rating: 1500, rd: 200, volatility: 0.06 }, [
      { rating: 1400, rd: 30, score: 1 },
      { rating: 1550, rd: 100, score: 0 },
      { rating: 1700, rd: 300, score: 0 },
    ]);
    // The paper rounds intermediate values; our calculation retains full precision.
    expect(Math.abs(next.rating - 1464.06)).toBeLessThan(0.02);
    expect(next.rating).toBeCloseTo(1464.050671, 6);
    expect(next.rd).toBeCloseTo(151.52, 2);
    expect(next.volatility).toBeCloseTo(0.059996, 6);
  });
  it("increases on a solve and decreases on a failure with symmetric equal opponents", () => {
    const solved = calculateNewRating(DEFAULT_PUZZLE_RATING, 1500, true);
    const failed = calculateNewRating(DEFAULT_PUZZLE_RATING, 1500, false);
    expect(solved.rating).toBeGreaterThan(1500);
    expect(failed.rating).toBeLessThan(1500);
    expect(solved.rating - 1500).toBeCloseTo(1500 - failed.rating);
    expect(solved.rd).toBeLessThan(350);
    expect(solved.volatility).toBeGreaterThan(0);
  });
  it("rewards harder puzzles more and reduces changes as confidence grows", () => {
    expect(calculateNewRating(DEFAULT_PUZZLE_RATING, 1800, true).rating).toBeGreaterThan(
      calculateNewRating(DEFAULT_PUZZLE_RATING, 1200, true).rating
    );
    expect(
      calculateNewRating({ ...DEFAULT_PUZZLE_RATING, rd: 50 }, 1500, true).rating
    ).toBeLessThan(calculateNewRating(DEFAULT_PUZZLE_RATING, 1500, true).rating);
  });
  it("increases uncertainty in an inactive rating period", () => {
    const next = calculateRatingPeriod(DEFAULT_PUZZLE_RATING, []);
    expect(next.rating).toBe(1500);
    expect(next.rd).toBeGreaterThan(350);
  });
  it("remains finite over many alternating outcomes", () => {
    let state = DEFAULT_PUZZLE_RATING;
    for (let i = 0; i < 1000; i++) state = calculateNewRating(state, 1500, i % 2 === 0);
    expect(Object.values(state).every(Number.isFinite)).toBe(true);
    expect(state.rd).toBeGreaterThan(0);
  });
  it("rejects invalid player and opponent ratings", () => {
    expect(() => calculateNewRating({ ...DEFAULT_PUZZLE_RATING, rd: 0 }, 1500, true)).toThrow();
    expect(() => calculateNewRating(DEFAULT_PUZZLE_RATING, NaN, false)).toThrow();
  });
});
