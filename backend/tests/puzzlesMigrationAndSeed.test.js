const { puzzlesData } = require("../database/seeds/seedPuzzles");
const { generateMockMatches, OPENINGS, PLAYERS } = require("../database/seed");
const sampleMatches = require("../database/seeds/sampleMatches.json");

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

describe("Realistic Historical Match Seed Generator (Issue #796)", () => {
	test("sampleMatches contains exactly 10 classic master opening lines with standard PGN and ECO codes", () => {
		expect(sampleMatches).toBeDefined();
		expect(Array.isArray(sampleMatches)).toBe(true);
		expect(sampleMatches.length).toBe(10);

		for (const opening of sampleMatches) {
			expect(typeof opening.name).toBe("string");
			expect(opening.name.length).toBeGreaterThan(0);
			expect(typeof opening.eco).toBe("string");
			expect(/^[A-E]\d{2}$/.test(opening.eco)).toBe(true);
			expect(typeof opening.pgn).toBe("string");
			expect(opening.pgn.length).toBeGreaterThan(10);
			expect(Array.isArray(opening.moves)).toBe(true);
			expect(opening.moves.length).toBeGreaterThanOrEqual(6);
			for (const m of opening.moves) {
				expect(m.from).toHaveProperty("file");
				expect(m.from).toHaveProperty("rank");
				expect(m.to).toHaveProperty("file");
				expect(m.to).toHaveProperty("rank");
				expect(typeof m.fen).toBe("string");
				expect(m.fen.length).toBeGreaterThan(15);
			}
		}
	});

	test("generateMockMatches produces 100 completed matches with realistic outcome distribution", () => {
		const matches = generateMockMatches(PLAYERS, 100);
		expect(matches.length).toBe(100);

		const whiteWins = matches.filter((m) => m.winner === "white" && !m.is_draw);
		const blackWins = matches.filter((m) => m.winner === "black" && !m.is_draw);
		const draws = matches.filter((m) => m.is_draw && m.winner === "draw");

		// Exactly ~45% white wins, ~40% black wins, ~15% draws
		expect(whiteWins.length).toBe(45);
		expect(blackWins.length).toBe(40);
		expect(draws.length).toBe(15);
	});

	test("seeded matches contain valid PGN, FEN, moves, and timestamps across the last 30 days", () => {
		const matches = generateMockMatches(PLAYERS, 100);
		const now = Date.now();
		const thirtyOneDaysAgo = now - 31 * 24 * 60 * 60 * 1000;

		for (const match of matches) {
			expect(match.status).toBe("completed");
			expect(match.game_code).toMatch(/^SEEDM\d{5}$/);
			expect(match.pgn).toContain("[Event ");
			expect(match.pgn).toContain("[ECO ");
			expect(match.board_state).toBeDefined();
			expect(typeof match.board_state.fen).toBe("string");
			expect(match.moves.length).toBeGreaterThan(0);

			const startedAt = new Date(match.game_started_at).getTime();
			const endedAt = new Date(match.ended_at).getTime();
			expect(startedAt).toBeGreaterThanOrEqual(thirtyOneDaysAgo);
			expect(startedAt).toBeLessThanOrEqual(now);
			expect(endedAt).toBeGreaterThanOrEqual(startedAt);
		}
	});

	test("players simulated span ratings between 1100 and 2200", () => {
		expect(PLAYERS.length).toBeGreaterThanOrEqual(5);
		const minRating = Math.min(...PLAYERS.map((p) => p.elo_rating || 1500));
		const maxRating = Math.max(...PLAYERS.map((p) => p.elo_rating || 1500));
		expect(minRating).toBeLessThanOrEqual(1200);
		expect(maxRating).toBeGreaterThanOrEqual(2100);
	});
});
