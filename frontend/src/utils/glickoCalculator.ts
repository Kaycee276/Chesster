/** Glicko 2, following Mark Glickman's rating period algorithm (tau = 0.5). */
export interface GlickoRating {
  rating: number;
  rd: number;
  volatility: number;
}
export interface GlickoOpponent {
  rating: number;
  rd: number;
  score: number;
}
export const DEFAULT_PUZZLE_RATING: GlickoRating = { rating: 1500, rd: 350, volatility: 0.06 };
const SCALE = 173.7178;
const TAU = 0.5;

export function calculateRatingPeriod(
  player: GlickoRating,
  opponents: readonly GlickoOpponent[]
): GlickoRating {
  if (
    !Number.isFinite(player.rating) ||
    !Number.isFinite(player.rd) ||
    player.rd <= 0 ||
    !Number.isFinite(player.volatility) ||
    player.volatility <= 0
  ) {
    throw new Error("Invalid Glicko rating.");
  }
  const mu = (player.rating - 1500) / SCALE;
  const phi = player.rd / SCALE;
  if (!opponents.length) {
    return { ...player, rd: SCALE * Math.sqrt(phi * phi + player.volatility ** 2) };
  }
  let varianceSum = 0;
  let improvement = 0;
  for (const opponent of opponents) {
    if (
      !Number.isFinite(opponent.rating) ||
      !Number.isFinite(opponent.rd) ||
      opponent.rd < 0 ||
      !Number.isFinite(opponent.score) ||
      opponent.score < 0 ||
      opponent.score > 1
    ) {
      throw new Error("Invalid Glicko opponent.");
    }
    const g = 1 / Math.sqrt(1 + (3 * (opponent.rd / SCALE) ** 2) / Math.PI ** 2);
    // Bound the exponent for numerical stability at extreme rating differences.
    const exponent = Math.max(-35, Math.min(35, -g * (mu - (opponent.rating - 1500) / SCALE)));
    const expected = 1 / (1 + Math.exp(exponent));
    varianceSum += g * g * expected * (1 - expected);
    improvement += g * (opponent.score - expected);
  }
  const v = 1 / varianceSum;
  const delta = v * improvement;
  const a = Math.log(player.volatility ** 2);
  const f = (x: number) => {
    const exp = Math.exp(x);
    return (
      (exp * (delta * delta - phi * phi - v - exp)) / (2 * (phi * phi + v + exp) ** 2) -
      (x - a) / TAU ** 2
    );
  };
  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0 && k < 1000) k++;
    B = a - k * TAU;
  }
  let fA = f(A);
  let fB = f(B);
  for (let i = 0; Math.abs(B - A) > 0.000001 && i < 1000; i++) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA /= 2;
    }
    B = C;
    fB = fC;
  }
  const volatility = Math.exp(A / 2);
  const phiStar = Math.sqrt(phi * phi + volatility * volatility);
  const newPhi = 1 / Math.sqrt(1 / phiStar ** 2 + 1 / v);
  return {
    rating: 1500 + SCALE * (mu + newPhi * newPhi * improvement),
    rd: SCALE * newPhi,
    volatility,
  };
}

/** Puzzles have fixed strength, so their opponent RD is zero. */
export function calculateNewRating(
  player: GlickoRating,
  puzzleRating: number,
  isSolved: boolean
): GlickoRating {
  return calculateRatingPeriod(player, [{ rating: puzzleRating, rd: 0, score: isSolved ? 1 : 0 }]);
}
