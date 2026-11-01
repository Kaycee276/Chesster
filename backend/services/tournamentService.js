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
		const { executeWithRetry } = require("../database/transactionRetry");

		return executeWithRetry(
			async () => {
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

				try {
					const leaderboardService = require("./leaderboardService");
					if (leaderboardService && typeof leaderboardService.invalidateLeaderboardCache === "function") {
						await leaderboardService.invalidateLeaderboardCache();
					}
				} catch (err) {
					logger.warn("[TournamentService] Failed to invalidate leaderboard cache:", err.message);
				}

				return {
					completedMatchId: matchId,
					winner: winnerAddress,
					isChampionship: true,
					escrowTx,
				};
			},
			{ context: `advance-match-winner-${tournamentId}-${matchId}` }
		);
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

	/**
	 * Generate the next Swiss round without repeating an opponent. Players are
	 * ordered by score, then rating, then wallet address for deterministic ties.
	 * A colour preference is chosen from each player's previous colour balance.
	 * The lowest-ranked player who has not received a bye gets the odd-player bye.
	 */
	async generateSwissRoundPairings(tournamentId, roundNumber) {
		if (!Number.isInteger(roundNumber) || roundNumber < 1) {
			throw new Error("roundNumber must be a positive integer");
		}
		const [participants, matches] = await Promise.all([
			tournamentModel.getParticipants(tournamentId),
			tournamentModel.getBracketMatches(tournamentId),
		]);
		return pairSwissRound(participants || [], matches || [], roundNumber);
	}

	/**
	 * Build hierarchical round-by-round bracket tree for tournament visualization.
	 * @param {string} tournamentId
	 * @returns {Promise<object>} { totalRounds, rounds }
	 */
	async getBracketTree(tournamentId) {
		const [matches, participants] = await Promise.all([
			tournamentModel.getBracketMatches(tournamentId),
			tournamentModel.getParticipants(tournamentId),
		]);

		const participantMap = new Map();
		for (const p of participants || []) {
			const addr = p.wallet_address || p.walletAddress || p.address;
			participantMap.set(addr, {
				walletAddress: addr,
				username: p.username || null,
				rating: p.rating ?? p.elo ?? null,
				seed: p.seed ?? null,
			});
		}

		const roundsMap = new Map();
		for (const m of matches || []) {
			const roundNum = m.round;
			if (!roundsMap.has(roundNum)) {
				roundsMap.set(roundNum, []);
			}
			roundsMap.get(roundNum).push({
				id: m.id,
				matchNumber: m.match_number ?? m.match_order,
				round: m.round,
				status: m.status,
				gameCode: m.game_code || null,
				winner: m.winner || null,
				playerOne: m.player_one || m.player1_address ? (participantMap.get(m.player_one || m.player1_address) || { walletAddress: m.player_one || m.player1_address, username: null, rating: null, seed: null }) : null,
				playerTwo: m.player_two || m.player2_address ? (participantMap.get(m.player_two || m.player2_address) || { walletAddress: m.player_two || m.player2_address, username: null, rating: null, seed: null }) : null,
			});
		}

		const totalRounds = roundsMap.size;
		const sortedRoundNums = Array.from(roundsMap.keys()).sort((a, b) => a - b);
		const rounds = sortedRoundNums.map((roundNum) => {
			let name = `Round ${roundNum}`;
			if (roundNum === totalRounds) {
				name = "Final";
			} else if (roundNum === totalRounds - 1 && totalRounds > 1) {
				name = "Semi-Final";
			}
			return {
				round: roundNum,
				name,
				matches: roundsMap.get(roundNum),
			};
		});

		return { totalRounds, rounds };
	}

	/**
	 * Formats and escapes a string/number as an RFC 4180 CSV cell.
	 *
	 * @param {*} value
	 * @returns {string}
	 */
	formatCsvCell(value) {
		if (value === null || value === undefined) return "";
		let text = String(value);
		if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
		return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
	}

	/**
	 * Generates an RFC 4180 compliant CSV export for tournament match telemetry and player rankings.
	 * Headers: Rank,Wallet,Wins,Losses,Draws,Points,PrizeXLM
	 *
	 * @param {string} tournamentId
	 * @returns {Promise<string>}
	 */
	async generateTournamentCsv(tournamentId) {
		const [participants, matches, tournament] = await Promise.all([
			tournamentModel.getParticipants(tournamentId),
			tournamentModel.getBracketMatches(tournamentId),
			typeof tournamentModel.getTournamentById === "function"
				? tournamentModel.getTournamentById(tournamentId)
				: tournamentModel.getTournament(tournamentId),
		]);

		const stats = new Map();
		for (const p of participants || []) {
			const wallet = p.wallet_address || p.walletAddress || p.address || "";
			stats.set(wallet, {
				wallet,
				wins: Number(p.wins ?? 0),
				losses: Number(p.losses ?? 0),
				draws: Number(p.draws ?? 0),
				points: Number(p.points ?? p.score ?? 0),
				prizeXLM: Number(p.prize_xlm ?? p.prizeXlm ?? p.prize_amount ?? 0),
				tieBreak: Number(p.tie_break ?? p.tiebreak ?? p.buchholz ?? p.seed_number ?? p.seed ?? 0),
			});
		}

		// Calculate stats from matches if participants don't have explicit wins/losses tracked
		const hasExplicitMatchCounts = (participants || []).some(
			(p) => p.wins !== undefined || p.losses !== undefined || p.draws !== undefined
		);

		if (!hasExplicitMatchCounts && (matches || []).length > 0) {
			for (const m of matches) {
				if (m.status !== "completed" && m.status !== "bye") continue;
				const p1 = m.player_one || m.player_white || m.player1_address;
				const p2 = m.player_two || m.player_black || m.player2_address;
				const winner = m.winner || m.winner_address;

				if (m.status === "bye") {
					if (winner && stats.has(winner)) {
						stats.get(winner).wins += 1;
						stats.get(winner).points += 1;
					}
					continue;
				}

				if (winner) {
					if (stats.has(winner)) {
						stats.get(winner).wins += 1;
						stats.get(winner).points += 1;
					}
					const loser = winner === p1 ? p2 : p1;
					if (loser && stats.has(loser)) {
						stats.get(loser).losses += 1;
					}
				} else if (m.is_draw || m.draw) {
					if (p1 && stats.has(p1)) {
						stats.get(p1).draws += 1;
						stats.get(p1).points += 0.5;
					}
					if (p2 && stats.has(p2)) {
						stats.get(p2).draws += 1;
						stats.get(p2).points += 0.5;
					}
				}
			}
		}

		// If tournament has winner_address and prize_pool, assign prize if prizeXLM is 0
		if (tournament && tournament.winner_address && stats.has(tournament.winner_address)) {
			const winnerEntry = stats.get(tournament.winner_address);
			if (winnerEntry.prizeXLM === 0 && Number(tournament.prize_pool || tournament.prizePool || 0) > 0) {
				winnerEntry.prizeXLM = Number(tournament.prize_pool || tournament.prizePool);
			}
		}

		const standings = Array.from(stats.values()).sort((a, b) => {
			if (b.points !== a.points) return b.points - a.points;
			if (b.wins !== a.wins) return b.wins - a.wins;
			if (a.losses !== b.losses) return a.losses - b.losses;
			if (b.tieBreak !== a.tieBreak) return b.tieBreak - a.tieBreak;
			return a.wallet.localeCompare(b.wallet);
		});

		const headers = ["Rank", "Wallet", "Wins", "Losses", "Draws", "Points", "PrizeXLM"];
		const rows = [headers.join(",")];

		standings.forEach((player, index) => {
			const rank = index + 1;
			const row = [
				this.formatCsvCell(rank),
				this.formatCsvCell(player.wallet),
				this.formatCsvCell(player.wins),
				this.formatCsvCell(player.losses),
				this.formatCsvCell(player.draws),
				this.formatCsvCell(player.points),
				this.formatCsvCell(player.prizeXLM),
			];
			rows.push(row.join(","));
		});

		return rows.join("\n");
	}
}

function pairSwissRound(players, previousMatches, roundNumber) {
	const history = new Map();
	const colours = new Map();
	for (const match of previousMatches) {
		const a = match.player_one || match.player1_address;
		const b = match.player_two || match.player2_address;
		if (a && b) {
			if (!history.has(a)) history.set(a, new Set());
			if (!history.has(b)) history.set(b, new Set());
			history.get(a).add(b);
			history.get(b).add(a);
		}
		if (match.player_white) colours.set(match.player_white, (colours.get(match.player_white) || 0) + 1);
		if (match.player_black) colours.set(match.player_black, (colours.get(match.player_black) || 0) - 1);
	}
	const ranked = players.filter((p) => p && (p.wallet_address || p.walletAddress))
		.map((p) => ({ ...p, wallet_address: p.wallet_address || p.walletAddress, score: Number(p.score || 0), elo: Number(p.elo || p.rating || 1200) }))
		.sort((a, b) => b.score - a.score || b.elo - a.elo || a.wallet_address.localeCompare(b.wallet_address));
	const pairings = [];
	let bye = null;
	if (ranked.length % 2 === 1) {
		for (let i = ranked.length - 1; i >= 0; i -= 1) {
			const candidate = ranked[i];
			const hasBye = previousMatches.some((m) => m.status === "bye" && (m.winner || m.player_one || m.player_two) === candidate.wallet_address);
			if (!hasBye) { bye = { walletAddress: candidate.wallet_address, round: roundNumber, status: "bye" }; ranked.splice(i, 1); break; }
		}
	}
	while (ranked.length) {
		const player = ranked.shift();
		const opponentIndex = ranked.findIndex((candidate) => !(history.get(player.wallet_address) || new Set()).has(candidate.wallet_address));
		if (opponentIndex === -1) throw new Error(`Unable to find a non-rematch opponent for ${player.wallet_address}`);
		const opponent = ranked.splice(opponentIndex, 1)[0];
		const playerBalance = colours.get(player.wallet_address) || 0;
		const opponentBalance = colours.get(opponent.wallet_address) || 0;
		const white = playerBalance <= opponentBalance ? player.wallet_address : opponent.wallet_address;
		const black = white === player.wallet_address ? opponent.wallet_address : player.wallet_address;
		pairings.push({ round: roundNumber, player_one: white, player_two: black, player_white: white, player_black: black, status: "ready" });
	}
	return { round: roundNumber, pairings, bye };
}

/**
 * Calculates Buchholz tiebreak score for each player:
 * The sum of the final scores of each of the opponents that player faced.
 *
 * @param {Array<object>} players - Array of { wallet_address, score, ... }
 * @param {Array<object>} matches - Array of completed matches
 * @param {object} options - Optional { median: boolean } for Median-Buchholz (drops highest and lowest)
 * @returns {Map<string, number>} Map of wallet_address -> buchholz score
 */
function calculateBuchholz(players, matches, options = {}) {
	const scoreMap = new Map();
	for (const p of players) {
		const addr = p.wallet_address || p.walletAddress;
		scoreMap.set(addr, Number(p.score || 0));
	}

	const opponentsMap = new Map();
	for (const p of players) {
		const addr = p.wallet_address || p.walletAddress;
		opponentsMap.set(addr, []);
	}

	for (const m of matches) {
		if (m.status === "bye") continue;
		const p1 = m.player_one || m.player1_address;
		const p2 = m.player_two || m.player2_address;
		if (p1 && p2 && opponentsMap.has(p1) && opponentsMap.has(p2)) {
			opponentsMap.get(p1).push(p2);
			opponentsMap.get(p2).push(p1);
		}
	}

	const buchholzMap = new Map();
	for (const [addr, opps] of opponentsMap.entries()) {
		let oppScores = opps.map((oppAddr) => scoreMap.get(oppAddr) || 0);
		if (options.median && oppScores.length > 2) {
			oppScores.sort((a, b) => a - b);
			oppScores = oppScores.slice(1, -1);
		}
		const sum = oppScores.reduce((acc, s) => acc + s, 0);
		buchholzMap.set(addr, sum);
	}

	return buchholzMap;
}

/**
 * Calculates Sonneborn-Berger tiebreak score for each player:
 * Sum of the scores of opponents defeated + half the scores of opponents drawn against.
 *
 * @param {Array<object>} players - Array of { wallet_address, score, ... }
 * @param {Array<object>} matches - Array of completed matches
 * @returns {Map<string, number>} Map of wallet_address -> sonneborn-berger score
 */
function calculateSonnebornBerger(players, matches) {
	const scoreMap = new Map();
	for (const p of players) {
		const addr = p.wallet_address || p.walletAddress;
		scoreMap.set(addr, Number(p.score || 0));
	}

	const sbMap = new Map();
	for (const p of players) {
		const addr = p.wallet_address || p.walletAddress;
		sbMap.set(addr, 0);
	}

	for (const m of matches) {
		if (m.status === "bye") continue;
		const p1 = m.player_one || m.player1_address;
		const p2 = m.player_two || m.player2_address;
		if (!p1 || !p2 || !sbMap.has(p1) || !sbMap.has(p2)) continue;

		const winner = m.winner;
		const isDraw = m.is_draw || m.result === "draw" || (!winner && m.status === "completed");

		if (winner === p1) {
			sbMap.set(p1, sbMap.get(p1) + (scoreMap.get(p2) || 0));
		} else if (winner === p2) {
			sbMap.set(p2, sbMap.get(p2) + (scoreMap.get(p1) || 0));
		} else if (isDraw) {
			sbMap.set(p1, sbMap.get(p1) + 0.5 * (scoreMap.get(p2) || 0));
			sbMap.set(p2, sbMap.get(p2) + 0.5 * (scoreMap.get(p1) || 0));
		}
	}

	return sbMap;
}

/**
 * Calculates all Swiss-system tiebreak scores and returns ranked player standings.
 *
 * @param {Array<object>} players - Array of players
 * @param {Array<object>} matches - Array of all tournament matches
 * @returns {Array<object>} Ranked players with score, buchholz, and sonnebornBerger
 */
function calculateTiebreaks(players, matches) {
	const buchholzMap = calculateBuchholz(players, matches);
	const sbMap = calculateSonnebornBerger(players, matches);

	const enriched = players.map((p) => {
		const addr = p.wallet_address || p.walletAddress;
		const score = Number(p.score || 0);
		const buchholz = buchholzMap.get(addr) || 0;
		const sonnebornBerger = sbMap.get(addr) || 0;
		return {
			...p,
			wallet_address: addr,
			score,
			buchholz,
			sonnebornBerger,
		};
	});

	// Sort rank: Score desc, Buchholz desc, Sonneborn-Berger desc, Elo desc
	enriched.sort((a, b) => {
		if (b.score !== a.score) return b.score - a.score;
		if (b.buchholz !== a.buchholz) return b.buchholz - a.buchholz;
		if (b.sonnebornBerger !== a.sonnebornBerger) return b.sonnebornBerger - a.sonnebornBerger;
		const eloA = Number(a.elo || a.rating || 1200);
		const eloB = Number(b.elo || b.rating || 1200);
		if (eloB !== eloA) return eloB - eloA;
		return a.wallet_address.localeCompare(b.wallet_address);
	});

	return enriched.map((p, index) => ({
		...p,
		rank: index + 1,
	}));
}

function broadcastTournamentEvent(io, tournamentId, eventName, payload) {
	if (!io) return;
	io.to(`tournament:${tournamentId}`).emit(eventName, {
		tournamentId,
		timestamp: new Date().toISOString(),
		...payload,
	});
}

function emitPlayerJoined(io, tournamentId, payload) {
	broadcastTournamentEvent(io, tournamentId, "tournament:player_joined", payload);
}

function emitBracketGenerated(io, tournamentId, payload) {
	broadcastTournamentEvent(io, tournamentId, "tournament:bracket_generated", payload);
}

function emitMatchReady(io, tournamentId, payload) {
	broadcastTournamentEvent(io, tournamentId, "tournament:match_ready", payload);
}

function emitMatchCompleted(io, tournamentId, payload) {
	broadcastTournamentEvent(io, tournamentId, "tournament:match_completed", payload);
}

function emitTournamentCompleted(io, tournamentId, payload) {
	broadcastTournamentEvent(io, tournamentId, "tournament:completed", payload);
}

const tournamentService = new TournamentService();
tournamentService.__pairSwissRoundForTest = pairSwissRound;
tournamentService.calculateBuchholz = calculateBuchholz;
tournamentService.calculateSonnebornBerger = calculateSonnebornBerger;
tournamentService.calculateTiebreaks = calculateTiebreaks;
tournamentService.broadcastTournamentEvent = broadcastTournamentEvent;
tournamentService.emitPlayerJoined = emitPlayerJoined;
tournamentService.emitBracketGenerated = emitBracketGenerated;
tournamentService.emitMatchReady = emitMatchReady;
tournamentService.emitMatchCompleted = emitMatchCompleted;
tournamentService.emitTournamentCompleted = emitTournamentCompleted;

module.exports = tournamentService;
module.exports.calculateBuchholz = calculateBuchholz;
module.exports.calculateSonnebornBerger = calculateSonnebornBerger;
module.exports.calculateTiebreaks = calculateTiebreaks;
module.exports.broadcastTournamentEvent = broadcastTournamentEvent;
module.exports.emitPlayerJoined = emitPlayerJoined;
module.exports.emitBracketGenerated = emitBracketGenerated;
module.exports.emitMatchReady = emitMatchReady;
module.exports.emitMatchCompleted = emitMatchCompleted;
module.exports.emitTournamentCompleted = emitTournamentCompleted;
