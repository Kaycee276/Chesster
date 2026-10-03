import { describe, expect, it } from "vitest";
import {
	analyzeAccuracy,
	CPL_THRESHOLDS,
	classifyMove,
	centipawnLoss,
	formatAccuracy,
	meanCpl,
	MOVE_QUALITY_META,
	moveAccuracyPercent,
} from "./moveAccuracy";
import { MATE_SCORE_CP } from "./engineEvaluation";

describe("classifyMove", () => {
	it("classifies by centipawn-loss thresholds", () => {
		expect(classifyMove(0)).toBe("best");
		expect(classifyMove(15)).toBe("best");
		expect(classifyMove(16)).toBe("good");
		expect(classifyMove(60)).toBe("good");
		expect(classifyMove(61)).toBe("inaccuracy");
		expect(classifyMove(150)).toBe("inaccuracy");
		expect(classifyMove(151)).toBe("mistake");
		expect(classifyMove(300)).toBe("mistake");
		expect(classifyMove(301)).toBe("blunder");
		expect(classifyMove(900)).toBe("blunder");
	});

	it("treats evaluation gains for the mover as best", () => {
		expect(classifyMove(-120)).toBe("best");
	});

	it("uses the documented threshold values", () => {
		expect(CPL_THRESHOLDS).toEqual({ best: 15, good: 60, inaccuracy: 150, mistake: 300 });
	});
});

describe("moveAccuracyPercent", () => {
	it("yields 100% for perfect play", () => {
		expect(moveAccuracyPercent(0)).toBeCloseTo(100, 10);
	});

	it("follows 100 * exp(-0.004 * meanCpl)", () => {
		// Known sequence from the issue example: mean CPL of 30.7 -> ~88.4%.
		expect(moveAccuracyPercent(30.7)).toBeCloseTo(88.4, 1);
		// Heavier losses decay further: 100 cp mean -> ~67%.
		expect(moveAccuracyPercent(100)).toBeCloseTo(67.03, 2);
		expect(moveAccuracyPercent(300)).toBeCloseTo(30.12, 2);
	});

	it("clamps negative inputs to zero loss", () => {
		expect(moveAccuracyPercent(-5)).toBeCloseTo(100, 10);
	});
});

describe("meanCpl", () => {
	it("averages losses and treats an empty side as perfect", () => {
		expect(meanCpl([10, 20, 30])).toBe(20);
		expect(meanCpl([])).toBe(0);
	});
});

describe("centipawnLoss", () => {
	it("charges White when the evaluation drops", () => {
		expect(centipawnLoss({ before: 50, after: 20 }, "white")).toBe(30);
		// White gains: no loss for the mover.
		expect(centipawnLoss({ before: 20, after: 80 }, "white")).toBe(0);
	});

	it("charges Black when the evaluation rises", () => {
		expect(centipawnLoss({ before: -50, after: 40 }, "black")).toBe(90);
		expect(centipawnLoss({ before: 30, after: 10 }, "black")).toBe(0);
	});

	it("returns 0 when either evaluation is missing", () => {
		expect(centipawnLoss({ before: null, after: 10 }, "white")).toBe(0);
		expect(centipawnLoss({ before: 10, after: null }, "black")).toBe(0);
	});

	it("clamps mate-score swings to MATE_SCORE_CP", () => {
		expect(centipawnLoss({ before: 0, after: MATE_SCORE_CP * 2 }, "black")).toBe(MATE_SCORE_CP);
	});
});

describe("analyzeAccuracy", () => {
	it("classifies each move and aggregates per side", () => {
		// Eval sequence (White's perspective) before each ply:
		//   move 1 (W): 30 -> 25    loss 5   best
		//   move 2 (B): 25 -> 15    loss 0   best
		//   move 3 (W): 15 -> -80   loss 95  inaccuracy
		//   move 4 (B): -80 -> -60  loss 20  good
		//   move 5 (W): -60 -> -420 loss 360 blunder
		//   move 6 (B): -420 -> -430 loss 0  best
		const { moves, white, black } = analyzeAccuracy([30, 25, 15, -80, -60, -420, -430]);

		expect(moves.map((m) => m.quality)).toEqual([
			"best",
			"best",
			"inaccuracy",
			"good",
			"blunder",
			"best",
		]);

		// White losses: 5, 95, 360 → mean ≈ 153.33.
		expect(white.meanCpl).toBeCloseTo(460 / 3, 10);
		expect(white.total).toBe(3);
		expect(white.counts).toEqual({ best: 1, good: 0, inaccuracy: 1, mistake: 0, blunder: 1 });
		expect(white.accuracy).toBeCloseTo(moveAccuracyPercent(white.meanCpl), 10);

		// Black losses: 0, 20, 0 → mean ≈ 6.67, all near-best play.
		expect(black.meanCpl).toBeCloseTo(20 / 3, 10);
		expect(black.total).toBe(3);
		expect(black.counts).toEqual({ best: 2, good: 1, inaccuracy: 0, mistake: 0, blunder: 0 });
		expect(black.accuracy).toBeCloseTo(moveAccuracyPercent(black.meanCpl), 10);
		expect(black.accuracy).toBeGreaterThan(white.accuracy);
	});

	it("skips moves whose evaluations are unavailable", () => {
		//   move 1 (W): 30 -> null → cpl 0
		//   move 2 (B): null -> -50 → cpl 0
		//   move 3 (W): -50 -> -60 → cpl 10
		const { moves, white, black } = analyzeAccuracy([30, null, -50, -60]);

		expect(moves.map((m) => m.cpl)).toEqual([0, 0, 10]);
		// Only White's third move is counted toward accuracy.
		expect(white.total).toBe(1);
		expect(white.meanCpl).toBe(10);
		// Black's second move had no eval, so it is excluded too.
		expect(black.total).toBe(0);
		expect(black.accuracy).toBe(100);
	});

	it("returns perfect summaries for an empty game", () => {
		const { moves, white, black } = analyzeAccuracy([]);
		expect(moves).toHaveLength(0);
		expect(white).toEqual({
			accuracy: 100,
			meanCpl: 0,
			total: 0,
			counts: { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 },
		});
		expect(black).toEqual(white);
	});
});

describe("display helpers", () => {
	it("formats accuracy with one decimal", () => {
		expect(formatAccuracy(88.44)).toBe("88.4");
		expect(formatAccuracy(100)).toBe("100.0");
	});

	it("gives every quality a badge label, glyph and style class", () => {
		for (const quality of ["best", "good", "inaccuracy", "mistake", "blunder"] as const) {
			expect(MOVE_QUALITY_META[quality].label.length).toBeGreaterThan(0);
			expect(MOVE_QUALITY_META[quality].glyph.length).toBeGreaterThan(0);
			expect(MOVE_QUALITY_META[quality].className).toMatch(/^acc-/);
		}
	});
});
