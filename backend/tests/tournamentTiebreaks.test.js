const tournamentService = require("../services/tournamentService");

describe("Swiss-system tournament tiebreak scoring (Buchholz / Sonneborn-Berger)", () => {
	const players = [
		{ wallet_address: "P1", name: "Player 1", score: 2.5, elo: 1600 },
		{ wallet_address: "P2", name: "Player 2", score: 2.5, elo: 1550 },
		{ wallet_address: "P3", name: "Player 3", score: 2.0, elo: 1500 },
		{ wallet_address: "P4", name: "Player 4", score: 1.5, elo: 1450 },
		{ wallet_address: "P5", name: "Player 5", score: 1.5, elo: 1400 },
		{ wallet_address: "P6", name: "Player 6", score: 1.0, elo: 1350 },
		{ wallet_address: "P7", name: "Player 7", score: 1.0, elo: 1300 },
		{ wallet_address: "P8", name: "Player 8", score: 0.0, elo: 1250 },
	];

	// Simulated 3-round tournament match history
	const matches = [
		// Round 1
		{ round: 1, player_one: "P1", player_two: "P5", winner: "P1", status: "completed" },
		{ round: 1, player_one: "P2", player_two: "P6", winner: "P2", status: "completed" },
		{ round: 1, player_one: "P3", player_two: "P7", winner: "P3", status: "completed" },
		{ round: 1, player_one: "P4", player_two: "P8", winner: "P4", status: "completed" },

		// Round 2
		{ round: 2, player_one: "P1", player_two: "P3", winner: "P1", status: "completed" },
		{ round: 2, player_one: "P2", player_two: "P4", winner: "P2", status: "completed" },
		{ round: 2, player_one: "P5", player_two: "P7", winner: "P5", status: "completed" },
		{ round: 2, player_one: "P6", player_two: "P8", winner: "P6", status: "completed" },

		// Round 3
		// P1 vs P2 tied at 2.0 each, game ends in a draw
		{ round: 3, player_one: "P1", player_two: "P2", winner: null, is_draw: true, status: "completed" },
		{ round: 3, player_one: "P3", player_two: "P5", winner: null, is_draw: true, status: "completed" },
		{ round: 3, player_one: "P4", player_two: "P6", winner: null, is_draw: true, status: "completed" },
		{ round: 3, player_one: "P7", player_two: "P8", winner: "P7", status: "completed" },
	];

	describe("Buchholz calculation", () => {
		it("calculates standard Buchholz score as the sum of opponents' scores", () => {
			const buchholzMap = tournamentService.calculateBuchholz(players, matches);

			// P1 faced: P5 (score 1.5), P3 (score 2.0), P2 (score 2.5) -> sum = 6.0
			expect(buchholzMap.get("P1")).toBe(6.0);

			// P2 faced: P6 (score 1.0), P4 (score 1.5), P1 (score 2.5) -> sum = 5.0
			expect(buchholzMap.get("P2")).toBe(5.0);

			// P8 faced: P4 (1.5), P6 (1.0), P7 (1.0) -> sum = 3.5
			expect(buchholzMap.get("P8")).toBe(3.5);
		});

		it("supports Median-Buchholz dropping highest and lowest opponent scores", () => {
			const medianBuchholz = tournamentService.calculateBuchholz(players, matches, { median: true });

			// P1 opp scores: [1.5, 2.0, 2.5] -> drop 1.5 and 2.5 -> remaining [2.0] -> sum = 2.0
			expect(medianBuchholz.get("P1")).toBe(2.0);

			// P2 opp scores: [1.0, 1.5, 2.5] -> drop 1.0 and 2.5 -> remaining [1.5] -> sum = 1.5
			expect(medianBuchholz.get("P2")).toBe(1.5);
		});
	});

	describe("Sonneborn-Berger calculation", () => {
		it("calculates Sonneborn-Berger score correctly (defeated + 0.5 * drawn)", () => {
			const sbMap = tournamentService.calculateSonnebornBerger(players, matches);

			// P1 defeated: P5 (1.5) + P3 (2.0) = 3.5; drew: P2 (2.5) * 0.5 = 1.25 -> total = 4.75
			expect(sbMap.get("P1")).toBe(4.75);

			// P2 defeated: P6 (1.0) + P4 (1.5) = 2.5; drew: P1 (2.5) * 0.5 = 1.25 -> total = 3.75
			expect(sbMap.get("P2")).toBe(3.75);

			// P8 defeated no one, drew no one -> 0
			expect(sbMap.get("P8")).toBe(0);
		});
	});

	describe("calculateTiebreaks and player rankings", () => {
		it("ranks tied players by Buchholz and Sonneborn-Berger", () => {
			const ranked = tournamentService.calculateTiebreaks(players, matches);

			expect(ranked).toHaveLength(8);

			// P1 and P2 both have 2.5 points
			// P1 has Buchholz 6.0 and SB 4.75
			// P2 has Buchholz 5.0 and SB 3.75
			// Therefore, Rank 1 must be P1 and Rank 2 must be P2
			expect(ranked[0].wallet_address).toBe("P1");
			expect(ranked[0].rank).toBe(1);
			expect(ranked[0].buchholz).toBe(6.0);
			expect(ranked[0].sonnebornBerger).toBe(4.75);

			expect(ranked[1].wallet_address).toBe("P2");
			expect(ranked[1].rank).toBe(2);
			expect(ranked[1].buchholz).toBe(5.0);
			expect(ranked[1].sonnebornBerger).toBe(3.75);

			// Rank 3 is P3 with 2.0 points
			expect(ranked[2].wallet_address).toBe("P3");
			expect(ranked[2].rank).toBe(3);
		});

		it("handles byes without inflating opponent Buchholz", () => {
			const byeMatches = [
				{ round: 1, player_one: "P1", player_two: "P2", winner: "P1", status: "completed" },
				{ round: 1, player_one: "P3", status: "bye", winner: "P3" },
			];
			const smallPlayers = [
				{ wallet_address: "P1", score: 1.0 },
				{ wallet_address: "P2", score: 0.0 },
				{ wallet_address: "P3", score: 1.0 },
			];

			const buchholz = tournamentService.calculateBuchholz(smallPlayers, byeMatches);
			// P3 had a bye, so has no real opponents
			expect(buchholz.get("P3")).toBe(0);
			// P1 faced P2
			expect(buchholz.get("P1")).toBe(0);
			// P2 faced P1
			expect(buchholz.get("P2")).toBe(1.0);
		});
	});
});
