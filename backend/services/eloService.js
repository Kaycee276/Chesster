const supabase = require("../config/supabase");

const DEFAULT_K_FACTOR = 32;

/**
 * EloService — Standard FIDE Elo rating calculation.
 *
 * Formula:
 *   Expected score: EA = 1 / (1 + 10^((RB - RA) / 400))
 *   New rating:     RA' = RA + K * (SA - EA)
 *
 * Where:
 *   RA, RB = current ratings of players A and B
 *   SA     = actual score (1 = win, 0.5 = draw, 0 = loss)
 *   K      = K-factor (default 32)
 */
class EloService {
	/**
	 * Calculate the expected score for player A against player B.
	 * @param {number} ratingA - Current rating of player A
	 * @param {number} ratingB - Current rating of player B
	 * @returns {number} Expected score between 0 and 1
	 */
	calculateExpectedScore(ratingA, ratingB) {
		return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
	}

	/**
	 * Calculate new rating based on expected score and actual result.
	 * @param {number} currentRating - Player's current rating
	 * @param {number} expectedScore - Expected score (from calculateExpectedScore)
	 * @param {number} actualScore - Actual score (1 = win, 0.5 = draw, 0 = loss)
	 * @param {number} [kFactor=32] - K-factor
	 * @returns {number} New rating (rounded to nearest integer)
	 */
	calculateNewRating(currentRating, expectedScore, actualScore, kFactor = DEFAULT_K_FACTOR) {
		const newRating = currentRating + kFactor * (actualScore - expectedScore);
		return Math.round(newRating);
	}

	/**
	 * Update Elo ratings for both players after a game concludes.
	 * @param {string} player1Id - ID of player 1 (white)
	 * @param {string} player2Id - ID of player 2 (black)
	 * @param {string|null} winnerId - ID of winner, or null for draw
	 * @param {object} db - Supabase client instance
	 * @returns {Promise<object>} Updated ratings { player1: { old, new }, player2: { old, new } }
	 */
	async updateEloRatings(player1Id, player2Id, winnerId, db = supabase) {
		if (!player1Id || !player2Id) {
			throw new Error("Both player IDs are required");
		}
		if (player1Id === player2Id) {
			throw new Error("Players must be different");
		}

		const { data: player1, error: err1 } = await db
			.from("users")
			.select("id, elo_rating")
			.eq("id", player1Id)
			.single();

		if (err1) throw new Error(`Failed to fetch player 1: ${err1.message}`);
		if (!player1) throw new Error("Player 1 not found");

		const { data: player2, error: err2 } = await db
			.from("users")
			.select("id, elo_rating")
			.eq("id", player2Id)
			.single();

		if (err2) throw new Error(`Failed to fetch player 2: ${err2.message}`);
		if (!player2) throw new Error("Player 2 not found");

		const rating1 = player1.elo_rating ?? 1200;
		const rating2 = player2.elo_rating ?? 1200;

		const expected1 = this.calculateExpectedScore(rating1, rating2);
		const expected2 = this.calculateExpectedScore(rating2, rating1);

		let actual1, actual2;
		if (winnerId === null || winnerId === undefined) {
			actual1 = 0.5;
			actual2 = 0.5;
		} else if (winnerId === player1Id) {
			actual1 = 1;
			actual2 = 0;
		} else if (winnerId === player2Id) {
			actual1 = 0;
			actual2 = 1;
		} else {
			throw new Error("Winner ID must match one of the players");
		}

		const newRating1 = this.calculateNewRating(rating1, expected1, actual1);
		const newRating2 = this.calculateNewRating(rating2, expected2, actual2);

		const { error: updateErr1 } = await db
			.from("users")
			.update({ elo_rating: newRating1 })
			.eq("id", player1Id);

		if (updateErr1) throw new Error(`Failed to update player 1 rating: ${updateErr1.message}`);

		const { error: updateErr2 } = await db
			.from("users")
			.update({ elo_rating: newRating2 })
			.eq("id", player2Id);

		if (updateErr2) throw new Error(`Failed to update player 2 rating: ${updateErr2.message}`);

		console.log(
			`[EloService] Ratings updated — P1: ${rating1}→${newRating1}, P2: ${rating2}→${newRating2}`,
		);

		return {
			player1: { old: rating1, new: newRating1 },
			player2: { old: rating2, new: newRating2 },
		};
	}
}

module.exports = new EloService();
