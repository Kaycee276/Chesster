const tournamentModel = require("../models/tournamentModel");
const gameModel = require("../models/gameModel");
const escrowService = require("./escrowService");
const logger = require("../utils/logger");

class TournamentService {
	/**
	 * Seeds participants by sorting descending by Elo rating.
	 * Assigns a 1-based seed rank to each participant.
	 *
	 * @param {Array<object>} participants - Array of participant objects
	 * @returns {Array<object>} Seeded participants
	 */
	seedPlayers(participants = []) {
		if (!Array.isArray(participants)) return [];

		const normalized = participants.map((p) => {
			const address = p.wallet_address || p.walletAddress || p.address || p.player_address || "";
			const elo = Number(p.elo ?? p.rating ?? 1200);
			return {
				...p,
				wallet_address: address,
				elo: isNaN(elo) ? 1200 : elo,
			};
		});

		// Sort descending by Elo rating. Fall back to deterministic wallet address sort on tie.
		normalized.sort((a, b) => {
			if (b.elo !== a.elo) return b.elo - a.elo;
			return a.wallet_address.localeCompare(b.wallet_address);
		});

		return normalized.map((player, index) => ({
			...player,
			seed: index + 1,
		}));
	}

	/**
	 * Computes the canonical single-elimination seed sequence for a given bracket size.
	 * Guarantees that Seed 1 and Seed 2 are placed at opposite poles and meet only in the Finals.
	 *
	 * Example for size 4: [1, 4, 2, 3]
	 * Example for size 8: [1, 8, 4, 5, 2, 7, 3, 6]
	 *
	 * @param {number} bracketSize - Power of 2 (e.g., 2, 4, 8, 16, 32)
	 * @returns {Array<number>} Canonical sequence of seeds
	 */
	generateCanonicalBracketSeedOrder(bracketSize) {
		if (bracketSize < 2) return [1];

		let order = [1, 2];
		while (order.length < bracketSize) {
			const nextOrder = [];
			const currentSize = order.length * 2;
			for (const seed of order) {
				nextOrder.push(seed);
				nextOrder.push(currentSize + 1 - seed);
			}
			order = nextOrder;
		}

		return order;
	}

	/**
	 * Generates a full single-elimination tournament bracket from participants.
	 * Handles participant counts of 4, 8, 16, 32, as well as byes for non-powers of 2.
	 * Persists nodes to bracket_matches and advances byes automatically.
	 *
	 * @param {string} tournamentId
	 * @param {Array<object>} players
	 * @returns {Promise<Array<object>>} Generated bracket matches
	 */
	async generateSingleEliminationBracket(tournamentId, players = []) {
		const seeded = this.seedPlayers(players);
		if (seeded.length < 2) {
			throw new Error("A tournament bracket requires at least 2 participants");
		}

		const numRounds = Math.ceil(Math.log2(seeded.length));
		const bracketSize = Math.pow(2, numRounds);
		const seedOrder = this.generateCanonicalBracketSeedOrder(bracketSize);

		// Map seed number to player object
		const playerBySeed = new Map();
		for (const p of seeded) {
			playerBySeed.set(p.seed, p);
		}

		const matchesToCreate = [];

		// Round 1 pairings
		const numRound1Matches = bracketSize / 2;
		for (let m = 1; m <= numRound1Matches; m++) {
			const seed1 = seedOrder[(m - 1) * 2];
			const seed2 = seedOrder[(m - 1) * 2 + 1];

			const p1 = playerBySeed.get(seed1);
			const p2 = playerBySeed.get(seed2);

			let playerOne = p1 ? p1.wallet_address : null;
			let playerTwo = p2 ? p2.wallet_address : null;
			let winner = null;
			let status = "pending";

			if (p1 && !p2) {
				// Player 1 has a bye
				status = "bye";
				winner = playerOne;
			} else if (!p1 && p2) {
				// Player 2 has a bye
				status = "bye";
				winner = playerTwo;
			} else if (p1 && p2) {
				status = "ready";
			}

			matchesToCreate.push({
				tournament_id: tournamentId,
				round: 1,
				match_number: m,
				player_one: playerOne,
				player_two: playerTwo,
				winner,
				status,
				game_code: null,
			});
		}

		// Subsequent empty round nodes (Round 2 up to championship)
		for (let r = 2; r <= numRounds; r++) {
			const matchesInRound = Math.pow(2, numRounds - r);
			for (let m = 1; m <= matchesInRound; m++) {
				matchesToCreate.push({
					tournament_id: tournamentId,
					round: r,
					match_number: m,
					player_one: null,
					player_two: null,
					winner: null,
					status: "pending",
					game_code: null,
				});
			}
		}

		// Persist bracket matches
		const createdMatches = await tournamentModel.createBracketMatches(matchesToCreate);

		// Auto-advance any Round 1 matches that have byes
		const byeMatches = createdMatches.filter((m) => m.round === 1 && m.status === "bye" && m.winner);
		for (const byeMatch of byeMatches) {
			await this.advanceMatchWinner(tournamentId, byeMatch.id, byeMatch.winner);
		}

		// Transition tournament status to in_progress
		try {
			await tournamentModel.updateTournamentStatus(tournamentId, "in_progress");
		} catch (err) {
			logger.warn("[TournamentService] Failed to update tournament status to in_progress:", err.message);
		}

		return await tournamentModel.getBracketMatches(tournamentId);
	}

	/**
	 * Convenience alias for generateSingleEliminationBracket.
	 */
	async generateBracket(tournamentId, players) {
		return this.generateSingleEliminationBracket(tournamentId, players);
	}

	/**
	 * Advances the winner of a match to the downstream bracket slot in round + 1.
	 * When both players of a next-round match are determined, automatically instantiates a game room.
	 * If the championship (final round) match concludes, marks tournament completed and triggers on-chain escrow payout.
	 *
	 * @param {string} tournamentId
	 * @param {string} matchId
	 * @param {string} winnerAddress
	 * @returns {Promise<object>} Advancement result
	 */
	async advanceMatchWinner(tournamentId, matchId, winnerAddress) {
		const match = await tournamentModel.getMatchById(matchId);
		if (!match) throw new Error(`Match not found: ${matchId}`);

		// Set match winner and mark completed if not already
		if (match.status !== "completed" && match.status !== "bye") {
			await tournamentModel.setMatchWinner(matchId, winnerAddress);
		}

		// Find downstream next-round match
		const nextMatch = await tournamentModel.getNextRoundMatch(tournamentId, matchId);

		if (nextMatch) {
			// In single elimination, match M in round R feeds into match ceil(M/2) in round R+1
			// Odd match numbers take player_one, even match numbers take player_two
			const targetSlot = match.match_number % 2 === 1 ? "player_one" : "player_two";
			const updatedNextMatch = await tournamentModel.assignPlayerToMatch(
				nextMatch.id,
				winnerAddress,
				targetSlot,
			);

			let gameCode = null;

			// If both opponents are now set, automatically instantiate game room
			if (updatedNextMatch.player_one && updatedNextMatch.player_two) {
				try {
					const game = await gameModel.createGame(
						"chess",
						null,
						updatedNextMatch.player_one,
						600,
					);
					if (game && game.game_code) {
						gameCode = game.game_code;
						await gameModel.joinGame(gameCode, "black", updatedNextMatch.player_two);
						await tournamentModel.linkGameToMatch(nextMatch.id, gameCode);
					}
				} catch (err) {
					logger.error(`[TournamentService] Error instantiating game for match ${nextMatch.id}:`, {
						error: err.message,
					});
				}
			}

			return {
				completedMatchId: matchId,
				winner: winnerAddress,
				nextMatch: updatedNextMatch,
				gameCode,
				isChampionship: false,
			};
		}

		// No next match => This was the Championship / Finals!
		try {
			await tournamentModel.updateTournamentStatus(tournamentId, "completed");
		} catch (err) {
			logger.warn("[TournamentService] Failed to set tournament completed status:", err.message);
		}

		// Trigger on-chain payout distribution via escrowService
		let escrowTx = null;
		try {
			if (escrowService && typeof escrowService.completeTournament === "function") {
				escrowTx = await escrowService.completeTournament(tournamentId, [winnerAddress], [10000]);
			}
		} catch (err) {
			logger.error(`[TournamentService] On-chain tournament payout error for ${tournamentId}:`, {
				error: err.message,
			});
		}

		return {
			completedMatchId: matchId,
			winner: winnerAddress,
			isChampionship: true,
			escrowTx,
		};
	}

	/**
	 * Convenience alias for advanceMatchWinner.
	 */
	async advanceRound(tournamentId, completedMatchId, winnerAddress) {
		return this.advanceMatchWinner(tournamentId, completedMatchId, winnerAddress);
	}

	/**
	 * Checks whether all matches in a given tournament round have completed or bye status.
	 *
	 * @param {string} tournamentId
	 * @param {number} roundNumber
	 * @returns {Promise<boolean>}
	 */
	async checkRoundCompletion(tournamentId, roundNumber) {
		const matches = await tournamentModel.getBracketMatches(tournamentId);
		const roundMatches = matches.filter((m) => m.round === roundNumber);

		if (roundMatches.length === 0) return false;

		return roundMatches.every((m) => m.status === "completed" || m.status === "bye");
	}
}

module.exports = new TournamentService();
