import { describe, it, expect } from "vitest";
import {
  calculateWinProbability,
  evalToWinPercent,
  calculateMoveAccuracy,
  calculateHarmonicMean,
  calculateGameAccuracy,
  estimatePerformanceRating,
} from "./capsCalculator";

describe("CAPS Accuracy Engine (capsCalculator)", () => {
  describe("calculateWinProbability & evalToWinPercent", () => {
    it("returns 50% for equal (0 cp) positions", () => {
      expect(calculateWinProbability(0)).toBeCloseTo(0.5, 4);
      expect(evalToWinPercent(0)).toBeCloseTo(50, 4);
    });

    it("increases win probability when white has advantage", () => {
      const p = calculateWinProbability(400);
      expect(p).toBeGreaterThan(0.5);
      expect(evalToWinPercent(400)).toBeGreaterThan(50);
    });

    it("decreases win probability when white is at disadvantage", () => {
      const p = calculateWinProbability(-400);
      expect(p).toBeLessThan(0.5);
      expect(evalToWinPercent(-400)).toBeLessThan(50);
    });

    it("clamps extreme evaluations gracefully", () => {
      expect(evalToWinPercent(10000)).toBeGreaterThan(99.9);
      expect(evalToWinPercent(-10000)).toBeLessThan(0.1);
    });
  });

  describe("calculateMoveAccuracy", () => {
    it("awards 100% accuracy for a zero-loss move", () => {
      const acc = calculateMoveAccuracy(100, 100, "white");
      expect(acc).toBe(100);
    });

    it("awards 100% accuracy when position improves for mover", () => {
      const acc = calculateMoveAccuracy(0, 150, "white");
      expect(acc).toBe(100);
    });

    it("penalizes centipawn losses exponentially", () => {
      const minorLoss = calculateMoveAccuracy(100, 50, "white");
      const blunderLoss = calculateMoveAccuracy(100, -500, "white");
      expect(minorLoss).toBeGreaterThan(blunderLoss);
      expect(blunderLoss).toBeLessThan(50);
    });

    it("scores black moves from black's perspective", () => {
      // Position goes from +100 to -100 (Black improved drastically)
      const blackGoodMove = calculateMoveAccuracy(100, -100, "black");
      expect(blackGoodMove).toBe(100);

      // Position goes from -100 to +300 (Black blundered)
      const blackBlunder = calculateMoveAccuracy(-100, 300, "black");
      expect(blackBlunder).toBeLessThan(50);
    });
  });

  describe("calculateHarmonicMean", () => {
    it("returns 100 for an empty array", () => {
      expect(calculateHarmonicMean([])).toBe(100);
    });

    it("computes harmonic mean correctly", () => {
      const harmonic = calculateHarmonicMean([100, 100, 100]);
      expect(harmonic).toBe(100);
    });

    it("heavily weighs lower accuracies characteristic of harmonic mean", () => {
      const harmonic = calculateHarmonicMean([100, 50]);
      // Arithmetic is 75, Harmonic is 2 / (1/100 + 1/50) = 66.67
      expect(harmonic).toBeCloseTo(66.7, 1);
    });
  });

  describe("calculateGameAccuracy", () => {
    it("returns 100% for an empty or single-evaluation game", () => {
      const result = calculateGameAccuracy([0]);
      expect(result.whiteAccuracy).toBe(100);
      expect(result.blackAccuracy).toBe(100);
    });

    it("scores a grandmaster-like game with high accuracy (>90%)", () => {
      // Evals remain near 0 with slight fluctuations (high precision play)
      const gmEvals = [0, 5, 2, 8, 4, 10, 6, 12, 8, 10, 5, 8, 0];
      const { whiteAccuracy, blackAccuracy } = calculateGameAccuracy(gmEvals);
      expect(whiteAccuracy).toBeGreaterThan(90);
      expect(blackAccuracy).toBeGreaterThan(90);
    });

    it("scores a blunder-heavy game with low accuracy (<60%)", () => {
      // Massive blunders back and forth
      const blunderEvals = [0, -600, 500, -700, 800, -900];
      const { whiteAccuracy, blackAccuracy } = calculateGameAccuracy(blunderEvals);
      expect(whiteAccuracy).toBeLessThan(60);
      expect(blackAccuracy).toBeLessThan(60);
    });
  });

  describe("estimatePerformanceRating", () => {
    it("estimates master/GM rating for high accuracy", () => {
      expect(estimatePerformanceRating(98)).toBeGreaterThanOrEqual(2500);
      expect(estimatePerformanceRating(92)).toBeGreaterThanOrEqual(2100);
    });

    it("estimates intermediate/club rating for moderate accuracy", () => {
      expect(estimatePerformanceRating(82)).toBeGreaterThanOrEqual(1600);
      expect(estimatePerformanceRating(75)).toBeGreaterThanOrEqual(1200);
    });

    it("estimates novice rating for poor accuracy", () => {
      expect(estimatePerformanceRating(40)).toBeLessThan(1000);
    });
  });
});
