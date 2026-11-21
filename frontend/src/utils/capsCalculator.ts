/**
 * Centipawn Accuracy Percentage Score (CAPS) Engine (#683).
 *
 * Implements Chess.com-style CAPS calculation based on logistic win probabilities,
 * exponential ply accuracy loss, and harmonic mean aggregation for game accuracy.
 */

/**
 * Standard logistic win probability conversion:
 * P(win) = 1 / (1 + 10^(-eval / 400))
 */
export function calculateWinProbability(evalCp: number): number {
  return 1 / (1 + Math.pow(10, -evalCp / 400));
}

/**
 * Converts centipawns to win percentage (0 to 100%) using sigmoidal scaling.
 */
export function evalToWinPercent(cp: number): number {
  const clamped = Math.max(-2000, Math.min(2000, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * clamped)) - 1);
}

/**
 * Calculates move accuracy for a single ply:
 * Accuracy = 103.1668 * exp(-0.04354 * delta_loss) - 3.1669
 * Clamped to [0, 100]%.
 */
export function calculateMoveAccuracy(
  evalBefore: number,
  evalAfter: number,
  mover: "white" | "black" = "white",
): number {
  const sign = mover === "white" ? 1 : -1;
  const winBefore = evalToWinPercent(sign * evalBefore);
  const winAfter = evalToWinPercent(sign * evalAfter);
  const deltaLoss = Math.max(0, winBefore - winAfter);

  const raw = 103.1668 * Math.exp(-0.04354 * deltaLoss) - 3.1669;
  return Math.max(0, Math.min(100, Math.round(raw * 10) / 10));
}

/**
 * Harmonic mean of a list of accuracy percentages.
 */
export function calculateHarmonicMean(accuracies: number[]): number {
  if (accuracies.length === 0) return 100;
  const sumInv = accuracies.reduce((sum, v) => sum + 1 / Math.max(1, v), 0);
  const result = accuracies.length / sumInv;
  return Math.max(0, Math.min(100, Math.round(result * 10) / 10));
}

export interface GameAccuracyResult {
  whiteAccuracy: number;
  blackAccuracy: number;
}

/**
 * Aggregates harmonic mean accuracy scores for White and Black across evaluations.
 * evals is an array of centipawn evaluations starting from ply 0 (initial position).
 */
export function calculateGameAccuracy(evals: (number | null)[]): GameAccuracyResult {
  if (!evals || evals.length <= 1) {
    return { whiteAccuracy: 100, blackAccuracy: 100 };
  }

  const whiteAccuracies: number[] = [];
  const blackAccuracies: number[] = [];

  for (let i = 1; i < evals.length; i++) {
    const before = evals[i - 1];
    const after = evals[i];
    if (before === null || after === null) continue;
    const isWhiteMove = i % 2 === 1;

    const acc = calculateMoveAccuracy(before, after, isWhiteMove ? "white" : "black");
    if (isWhiteMove) {
      whiteAccuracies.push(acc);
    } else {
      blackAccuracies.push(acc);
    }
  }

  return {
    whiteAccuracy: calculateHarmonicMean(whiteAccuracies),
    blackAccuracy: calculateHarmonicMean(blackAccuracies),
  };
}

/**
 * Estimates performance rating from accuracy percentage.
 */
export function estimatePerformanceRating(accuracy: number): number {
  if (accuracy >= 98) return 2800;
  if (accuracy >= 95) return 2500 + Math.round((accuracy - 95) * 100);
  if (accuracy >= 90) return 2100 + Math.round((accuracy - 90) * 80);
  if (accuracy >= 80) return 1600 + Math.round((accuracy - 80) * 50);
  if (accuracy >= 70) return 1200 + Math.round((accuracy - 70) * 40);
  if (accuracy >= 50) return 800 + Math.round((accuracy - 50) * 20);
  return Math.max(400, Math.round(accuracy * 16));
}

export const calculatePerformanceRating = estimatePerformanceRating;
