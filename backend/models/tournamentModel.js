const supabase = require("../config/supabase");

const TOURNAMENT_STATUSES = ["draft", "open", "active", "in_progress", "completed", "cancelled"];
const PARTICIPANT_STATUSES = ["active", "eliminated", "withdrawn", "disqualified"];
const MATCH_STATUSES = ["pending", "ready", "in_progress", "completed", "bye", "cancelled"];

/**
 * TournamentModel — Supabase helpers for tournaments, participants, and bracket matches.
 * Backed by migrations 010 + 016 (016_create_tournament_tables.sql).
 */
class TournamentModel {
	/**
	 * Creates a new tournament record.
	 *
	 * @param {object} params
	 * @returns {Promise<object>}
	 */
	async createTournament({
		id,
		name,
		title = null,
		maxPlayers,
		max_players = 8,
		entryFee = 0,
		entry_fee = 0,
		coordinatorAddress = null,
		coordinator_address = null,
		startsAt = null,
		starts_at = null,
		prizePool = 0,
		prize_pool = 0,
		status = "open",
	}) {
		if (!name) throw new Error("Tournament name is required");
		const effectiveMax = maxPlayers || max_players;
		if (!effectiveMax || effectiveMax < 2) throw new Error("maxPlayers must be >= 2");
		if (!TOURNAMENT_STATUSES.includes(status)) {
			throw new Error(`Invalid tournament status: ${status}`);
		}

		const payload = {
			name,
			title: title || name,
			max_players: effectiveMax,
			entry_fee: entryFee || entry_fee || 0,
			coordinator_address: coordinatorAddress || coordinator_address,
			starts_at: startsAt || starts_at,
			prize_pool: prizePool || prize_pool || 0,
			status,
			current_round: 0,
		};
		if (id) payload.id = id;

		const { data, error } = await supabase
			.from("tournaments")
			.insert(payload)
			.select()
			.single();

		if (error) throw error;
		return data;
	}

	/**
	 * Retrieves tournament by UUID.
	 *
	 * @param {string} tournamentId
	 * @returns {Promise<object|null>}
	 */
	async getTournament(tournamentId) {
		const { data, error } = await supabase
			.from("tournaments")
			.select("*")
			.eq("id", tournamentId)
			.maybeSingle();

		if (error) throw error;
		return data || null;
	}

	/**
	 * Lists tournaments with optional status filtering.
	 *
	 * @param {object} [options]
	 * @returns {Promise<Array<object>>}
	 */
	async listTournaments({ status = null, limit = 50 } = {}) {
		let query = supabase
			.from("tournaments")
			.select("*")
			.order("created_at", { ascending: false })
			.limit(Math.min(100, Math.max(1, limit)));

		if (status) query = query.eq("status", status);

		const { data, error } = await query;
		if (error) throw error;
		return data || [];
	}

	/**
	 * Updates tournament status and extra fields.
	 *
	 * @param {string} tournamentId
	 * @param {string} status
	 * @param {object} [extra]
	 * @returns {Promise<object>}
	 */
	async updateTournamentStatus(tournamentId, status, extra = {}) {
		if (!TOURNAMENT_STATUSES.includes(status)) {
			throw new Error(`Invalid tournament status: ${status}`);
		}

		const updates = {
			status,
			updated_at: new Date().toISOString(),
			...extra,
		};

		const { data, error } = await supabase
			.from("tournaments")
			.update(updates)
			.eq("id", tournamentId)
			.select()
			.single();

		if (error) throw error;
		return data;
	}

	/**
	 * Registers a participant in a tournament.
	 *
	 * @param {string} tournamentId
	 * @param {string} walletAddress
	 * @param {number|null} [seedNumber=null]
	 * @returns {Promise<object>}
	 */
	async registerParticipant(tournamentId, walletAddress, seedNumber = null) {
		if (!walletAddress) throw new Error("walletAddress is required");

		const tournament = await this.getTournament(tournamentId);
		if (!tournament) throw new Error("Tournament not found");
		if (!["open", "draft"].includes(tournament.status)) {
			throw new Error("Tournament is not open for registration");
		}

		const payload = {
			tournament_id: tournamentId,
			wallet_address: walletAddress,
			seed_number: seedNumber,
			seed: seedNumber,
			status: "active",
			registered_at: new Date().toISOString(),
			joined_at: new Date().toISOString(),
		};

		const { data, error } = await supabase
			.from("tournament_participants")
			.insert(payload)
			.select()
			.single();

		if (error) {
			if (error.code === "23505") {
				throw new Error("Wallet already registered for this tournament");
			}
			throw error;
		}
		return data;
	}

	/**
	 * Alias for registerParticipant to support both naming styles.
	 *
	 * @param {string} tournamentId
	 * @param {string} walletAddress
	 * @param {number|null} [seed=null]
	 * @returns {Promise<object>}
	 */
	async addParticipant(tournamentId, walletAddress, seed = null) {
		const payload = {
			tournament_id: tournamentId,
			wallet_address: walletAddress,
			seed_number: seed,
			seed: seed,
			status: "active",
			registered_at: new Date().toISOString(),
			joined_at: new Date().toISOString(),
		};

		const { data, error } = await supabase
			.from("tournament_participants")
			.insert(payload)
			.select()
			.single();

		if (error) throw error;
		return data;
	}

	/**
	 * Lists participants for a tournament ordered by seed.
	 *
	 * @param {string} tournamentId
	 * @returns {Promise<Array<object>>}
	 */
	async listParticipants(tournamentId) {
		const { data, error } = await supabase
			.from("tournament_participants")
			.select("*")
			.eq("tournament_id", tournamentId)
			.order("seed_number", { ascending: true, nullsFirst: false });

		if (error) throw error;
		return data || [];
	}

	/**
	 * Alias for listParticipants ordered by seed.
	 *
	 * @param {string} tournamentId
	 * @returns {Promise<Array<object>>}
	 */
	async getParticipants(tournamentId) {
		return this.listParticipants(tournamentId);
	}

	/**
	 * Updates the status of a tournament participant.
	 *
	 * @param {string} tournamentId
	 * @param {string} walletAddress
	 * @param {string} status
	 * @returns {Promise<object>}
	 */
	async updateParticipantStatus(tournamentId, walletAddress, status) {
		if (!PARTICIPANT_STATUSES.includes(status)) {
			throw new Error(`Invalid participant status: ${status}`);
		}

		const { data, error } = await supabase
			.from("tournament_participants")
			.update({ status })
			.eq("tournament_id", tournamentId)
			.eq("wallet_address", walletAddress)
			.select()
			.single();

		if (error) throw error;
		return data;
	}

	/**
	 * Creates a single bracket match.
	 *
	 * @param {object} params
	 * @returns {Promise<object>}
	 */
	async createBracketMatch({
		tournamentId,
		round,
		matchNumber,
		playerOne = null,
		playerTwo = null,
		dependsOnMatchA = null,
		dependsOnMatchB = null,
		nextMatchId = null,
		status = "pending",
	}) {
		if (!tournamentId) throw new Error("tournamentId is required");
		if (!round || round < 1) throw new Error("round must be >= 1");
		if (!matchNumber || matchNumber < 1) throw new Error("matchNumber must be >= 1");
		if (!MATCH_STATUSES.includes(status)) {
			throw new Error(`Invalid match status: ${status}`);
		}

		const payload = {
			tournament_id: tournamentId,
			round,
			match_number: matchNumber,
			player_one: playerOne,
			player_two: playerTwo,
			player_white: playerOne,
			player_black: playerTwo,
			depends_on_match_a: dependsOnMatchA,
			depends_on_match_b: dependsOnMatchB,
			next_match_id: nextMatchId,
			status,
		};

		const { data, error } = await supabase
			.from("bracket_matches")
			.insert(payload)
			.select()
			.single();

		if (error) throw error;
		return data;
	}

	/**
	 * Bulk inserts matches into bracket_matches table.
	 *
	 * @param {Array<object>} matches
	 * @returns {Promise<Array<object>>}
	 */
	async createBracketMatches(matches) {
		if (!matches || matches.length === 0) return [];

		const normalized = matches.map((m) => ({
			...m,
			player_white: m.player_white || m.player_one || null,
			player_black: m.player_black || m.player_two || null,
			winner_address: m.winner_address || m.winner || null,
		}));

		const { data, error } = await supabase
			.from("bracket_matches")
			.insert(normalized)
			.select();

		if (error) throw error;
		return data || [];
	}

	/**
	 * Lists bracket matches for a tournament.
	 *
	 * @param {string} tournamentId
	 * @param {object} [filter]
	 * @returns {Promise<Array<object>>}
	 */
	async listBracketMatches(tournamentId, { round = null } = {}) {
		let query = supabase
			.from("bracket_matches")
			.select("*")
			.eq("tournament_id", tournamentId)
			.order("round", { ascending: true })
			.order("match_number", { ascending: true });

		if (round != null) query = query.eq("round", round);

		const { data, error } = await query;
		if (error) throw error;
		return data || [];
	}

	/**
	 * Alias for listBracketMatches.
	 *
	 * @param {string} tournamentId
	 * @returns {Promise<Array<object>>}
	 */
	async getBracketMatches(tournamentId) {
		return this.listBracketMatches(tournamentId);
	}

	/**
	 * Retrieves a single bracket match by its ID.
	 *
	 * @param {string} matchId
	 * @returns {Promise<object|null>}
	 */
	async getMatchById(matchId) {
		const { data, error } = await supabase
			.from("bracket_matches")
			.select("*")
			.eq("id", matchId)
			.maybeSingle();

		if (error) throw error;
		return data || null;
	}

	/**
	 * Retrieves a bracket match by tournament, round, and match_number.
	 *
	 * @param {string} tournamentId
	 * @param {number} round
	 * @param {number} matchNumber
	 * @returns {Promise<object|null>}
	 */
	async getMatchByTournamentRoundMatchNumber(tournamentId, round, matchNumber) {
		const { data, error } = await supabase
			.from("bracket_matches")
			.select("*")
			.eq("tournament_id", tournamentId)
			.eq("round", round)
			.eq("match_number", matchNumber)
			.maybeSingle();

		if (error) throw error;
		return data || null;
	}

	/**
	 * Retrieves a bracket match by associated game code.
	 *
	 * @param {string} gameCode
	 * @returns {Promise<object|null>}
	 */
	async getMatchByGameCode(gameCode) {
		const { data, error } = await supabase
			.from("bracket_matches")
			.select("*")
			.eq("game_code", gameCode)
			.maybeSingle();

		if (error) throw error;
		return data || null;
	}

	/**
	 * Updates the status of a bracket match.
	 *
	 * @param {string} matchId
	 * @param {string} status
	 * @returns {Promise<object>}
	 */
	async updateBracketMatchStatus(matchId, status) {
		if (!MATCH_STATUSES.includes(status)) {
			throw new Error(`Invalid match status: ${status}`);
		}

		const { data, error } = await supabase
			.from("bracket_matches")
			.update({ status, updated_at: new Date().toISOString() })
			.eq("id", matchId)
			.select()
			.single();

		if (error) throw error;
		return data;
	}

	/**
	 * Resolves a match with winner and completion status.
	 *
	 * @param {string} matchId
	 * @param {string} winnerAddress
	 * @param {object} [options]
	 * @returns {Promise<object>}
	 */
	async resolveMatch(matchId, winnerAddress, { gameCode = null, payoutTxHash = null } = {}) {
		if (!winnerAddress) throw new Error("winnerAddress is required");

		const updates = {
			winner: winnerAddress,
			winner_address: winnerAddress,
			status: "completed",
			updated_at: new Date().toISOString(),
		};
		if (gameCode) updates.game_code = gameCode;
		if (payoutTxHash) updates.payout_tx_hash = payoutTxHash;

		const { data, error } = await supabase
			.from("bracket_matches")
			.update(updates)
			.eq("id", matchId)
			.select()
			.single();

		if (error) throw error;
		return data;
	}

	/**
	 * Alias for resolveMatch.
	 *
	 * @param {string} matchId
	 * @param {string} winnerAddress
	 * @returns {Promise<object>}
	 */
	async setMatchWinner(matchId, winnerAddress) {
		return this.resolveMatch(matchId, winnerAddress);
	}

	/**
	 * Locates the downstream next-round match that the given match feeds into.
	 *
	 * @param {string} tournamentId
	 * @param {string} matchId
	 * @returns {Promise<object|null>}
	 */
	async getNextRoundMatch(tournamentId, matchId) {
		const current = await this.getMatchById(matchId);
		if (!current) return null;

		const nextRound = current.round + 1;
		const nextMatchNumber = Math.ceil(current.match_number / 2);

		return this.getMatchByTournamentRoundMatchNumber(
			tournamentId,
			nextRound,
			nextMatchNumber,
		);
	}

	/**
	 * Assigns a player address to a bracket match slot (player_one or player_two).
	 *
	 * @param {string} matchId
	 * @param {string} playerAddress
	 * @param {string} [slot]
	 * @returns {Promise<object>}
	 */
	async assignPlayerToMatch(matchId, playerAddress, slot = null) {
		const current = await this.getMatchById(matchId);
		if (!current) throw new Error(`Bracket match not found: ${matchId}`);

		let targetSlot = slot;
		if (!targetSlot) {
			if (!current.player_one) {
				targetSlot = "player_one";
			} else if (!current.player_two) {
				targetSlot = "player_two";
			} else {
				throw new Error(`Match ${matchId} already has two players assigned`);
			}
		}

		const updatePayload = {
			[targetSlot]: playerAddress,
			updated_at: new Date().toISOString(),
		};

		if (targetSlot === "player_one") updatePayload.player_white = playerAddress;
		if (targetSlot === "player_two") updatePayload.player_black = playerAddress;

		const finalP1 = targetSlot === "player_one" ? playerAddress : current.player_one;
		const finalP2 = targetSlot === "player_two" ? playerAddress : current.player_two;

		if (finalP1 && finalP2 && current.status === "pending") {
			updatePayload.status = "ready";
		}

		const { data, error } = await supabase
			.from("bracket_matches")
			.update(updatePayload)
			.eq("id", matchId)
			.select()
			.single();

		if (error) throw error;
		return data;
	}

	/**
	 * Links an instantiated game code to a bracket match and marks it in_progress.
	 *
	 * @param {string} matchId
	 * @param {string} gameCode
	 * @returns {Promise<object>}
	 */
	async linkGameToMatch(matchId, gameCode) {
		const { data, error } = await supabase
			.from("bracket_matches")
			.update({
				game_code: gameCode,
				status: "in_progress",
				updated_at: new Date().toISOString(),
			})
			.eq("id", matchId)
			.select()
			.single();

		if (error) throw error;
		return data;
	}

	/**
	 * Concludes the tournament and sets the champion.
	 *
	 * @param {string} tournamentId
	 * @param {string} winnerAddress
	 * @param {string} [payoutTxHash=null]
	 * @returns {Promise<object>}
	 */
	async setTournamentWinner(tournamentId, winnerAddress, payoutTxHash = null) {
		return this.updateTournamentStatus(tournamentId, "completed", {
			winner_address: winnerAddress,
			payout_tx_hash: payoutTxHash,
		});
	}

	/**
	 * Advances the tournament current_round.
	 *
	 * @param {string} tournamentId
	 * @param {number} nextRound
	 * @returns {Promise<object>}
	 */
	async advanceRound(tournamentId, nextRound) {
		if (!nextRound || nextRound < 1) throw new Error("nextRound must be >= 1");

		const { data, error } = await supabase
			.from("tournaments")
			.update({
				current_round: nextRound,
				status: "active",
				updated_at: new Date().toISOString(),
			})
			.eq("id", tournamentId)
			.select()
			.single();

		if (error) throw error;
		return data;
	}

	/**
	 * Fetches the full bracket tree with matches grouped by round.
	 *
	 * @param {string} tournamentId
	 * @returns {Promise<object>}
	 */
	async getBracketTree(tournamentId) {
		const [tournament, participants, matches] = await Promise.all([
			this.getTournament(tournamentId),
			this.listParticipants(tournamentId),
			this.listBracketMatches(tournamentId),
		]);

		if (!tournament) throw new Error("Tournament not found");

		const byRound = {};
		for (const match of matches) {
			const key = String(match.round);
			if (!byRound[key]) byRound[key] = [];
			byRound[key].push(match);
		}

		return { tournament, participants, matches, byRound };
	}
}

module.exports = new TournamentModel();
