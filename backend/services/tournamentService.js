const tournamentModel = require("../models/tournamentModel");

/**
 * TournamentService — read-side helpers for the tournament REST API.
 *
 * The bracket endpoint must return a hierarchical tree that frontend bracket
 * renderers can walk directly, so `getBracketTree` groups the flat
 * `bracket_matches` rows into rounds and enriches each match with the
 * participant usernames / ratings when available.
 */
class TournamentService {
	/**
	 * Build a round-by-round bracket tree for a tournament.
	 *
	 * @param {string} tournamentId
	 * @returns {Promise<{ tournamentId: string, rounds: Array, totalRounds: number }>}
	 */
	async getBracketTree(tournamentId) {
		const [matches, participants] = await Promise.all([
			tournamentModel.getBracketMatches(tournamentId),
			tournamentModel.getParticipants(tournamentId),
		]);

		const roster = new Map();
		for (const participant of participants) {
			roster.set(participant.wallet_address, participant);
		}

		const roundsByNumber = new Map();
		for (const match of matches) {
			if (!roundsByNumber.has(match.round)) {
				roundsByNumber.set(match.round, []);
			}
			roundsByNumber.get(match.round).push(this._formatMatch(match, roster));
		}

		const rounds = [...roundsByNumber.entries()]
			.sort((a, b) => a[0] - b[0])
			.map(([round, roundMatches]) => ({
				round,
				name: this._roundName(round, roundsByNumber.size),
				matches: roundMatches.sort((a, b) => a.matchNumber - b.matchNumber),
			}));

		return {
			tournamentId,
			totalRounds: rounds.length,
			rounds,
		};
	}

	/** Shape a raw bracket row into the API representation. */
	_formatMatch(match, roster) {
		return {
			id: match.id,
			round: match.round,
			matchNumber: match.match_number,
			status: match.status,
			gameCode: match.game_code || null,
			winner: match.winner || null,
			playerOne: this._formatPlayer(match.player_one, roster),
			playerTwo: this._formatPlayer(match.player_two, roster),
		};
	}

	/** Attach username / rating metadata to a wallet address when known. */
	_formatPlayer(walletAddress, roster) {
		if (!walletAddress) return null;
		const participant = roster.get(walletAddress);
		return {
			walletAddress,
			username: participant?.username || participant?.display_name || null,
			rating: participant?.rating ?? participant?.elo ?? null,
			seed: participant?.seed ?? null,
		};
	}

	/** Human-readable label for a round, e.g. "Final", "Semi-Final". */
	_roundName(round, totalRounds) {
		if (!totalRounds) return `Round ${round}`;
		const remaining = totalRounds - round;
		if (remaining === 0) return "Final";
		if (remaining === 1) return "Semi-Final";
		if (remaining === 2) return "Quarter-Final";
		return `Round ${round}`;
	}
}

module.exports = new TournamentService();
