const { puzzlesData } = require("../database/seeds/seedPuzzles");

describe("Chess Puzzles Seed & Schema Verification (Issue #321)", () => {
	test("puzzlesData contains exactly 100 tactical puzzles", () => {
		expect(puzzlesData).toBeDefined();
		expect(Array.isArray(puzzlesData)).toBe(true);
		expect(puzzlesData.length).toBe(100);
	});

	test("every puzzle has valid FEN, solution moves, rating, and theme tags", () => {
		for (const puzzle of puzzlesData) {
			expect(typeof puzzle.fen).toBe("string");
			expect(puzzle.fen.length).toBeGreaterThan(10);
			expect(typeof puzzle.solution_moves).toBe("string");
			expect(puzzle.solution_moves.length).toBeGreaterThan(3);
			expect(typeof puzzle.rating).toBe("number");
			expect(puzzle.rating).toBeGreaterThanOrEqual(700);
			expect(Array.isArray(puzzle.theme_tags)).toBe(true);
			expect(puzzle.theme_tags.length).toBeGreaterThan(0);
		}
	});

	test("puzzles span beginner, intermediate, and advanced rating tiers", () => {
		const beginner = puzzlesData.filter((p) => p.rating < 1200);
		const intermediate = puzzlesData.filter((p) => p.rating >= 1200 && p.rating < 1800);
		const advanced = puzzlesData.filter((p) => p.rating >= 1800);

		expect(beginner.length).toBeGreaterThan(15);
		expect(intermediate.length).toBeGreaterThan(15);
		expect(advanced.length).toBeGreaterThan(15);
	});
});