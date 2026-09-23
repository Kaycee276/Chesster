const supabase = require("../config/supabase");

/**
 * TournamentModel — thin data-access layer over the tournament tables created
 * by `database/migrations/010_create_tournaments_schema.sql`:
 *
 *   tournaments            (id, name, status, max_players, created_at, updated_at)
 *   tournament_participants(tournament_id, wallet_address, seed, joined_at)
 *   bracket_matches        (id, tournament_id, round, match_number, player_one,
 *                           player_two, winner, game_code, status)
 *
 * The model only talks to Supabase; all HTTP concerns live in the controller.
 */
class TournamentModel {
	/**
	 * List tournaments, optionally filtered by status.
	 * @param {{ status?: string, limit?: number }} options
	 */
	async listTournaments({ status, limit = 50 } = {}) {
		let query = supabase
			.from("tournaments")
			.select("*")
			.order("created_at", { ascending: false })
			.limit(limit);

		if (status) {
			query = query.eq("status", status);
		}

		const { data, error } = await query;
		if (error) throw error;
		return data || [];
	}

	/** Fetch a single tournament row by id, or null when it does not exist. */
	async getTournamentById(id) {
		const { data, error } = await supabase
			.from("tournaments")
			.select("*")
			.eq("id", id)
			.maybeSingle();

		if (error) throw error;
		return data || null;
	}

	/** Fetch the participant roster for a tournament, ordered by seed. */
	async getParticipants(tournamentId) {
		const { data, error } = await supabase
			.from("tournament_participants")
			.select("*")
			.eq("tournament_id", tournamentId)
			.order("seed", { ascending: true, nullsFirst: false });

		if (error) throw error;
		return data || [];
	}

	/** Fetch every bracket match for a tournament ordered by round then match. */
	async getBracketMatches(tournamentId) {
		const { data, error } = await supabase
			.from("bracket_matches")
			.select("*")
			.eq("tournament_id", tournamentId)
			.order("round", { ascending: true })
			.order("match_number", { ascending: true });

		if (error) throw error;
		return data || [];
	}

	/** Count the current number of registered participants. */
	async countParticipants(tournamentId) {
		const { count, error } = await supabase
			.from("tournament_participants")
			.select("wallet_address", { count: "exact", head: true })
			.eq("tournament_id", tournamentId);

		if (error) throw error;
		return count || 0;
	}

	/** Whether a wallet is already registered for the tournament. */
	async isParticipant(tournamentId, walletAddress) {
		const { data, error } = await supabase
			.from("tournament_participants")
			.select("wallet_address")
			.eq("tournament_id", tournamentId)
			.eq("wallet_address", walletAddress)
			.maybeSingle();

		if (error) throw error;
		return Boolean(data);
	}

	/** Insert a participant row and return it. */
	async addParticipant(tournamentId, walletAddress, seed = null) {
		const { data, error } = await supabase
			.from("tournament_participants")
			.insert({
				tournament_id: tournamentId,
				wallet_address: walletAddress,
				seed,
			})
			.select()
			.single();

		if (error) throw error;
		return data;
	}
}

module.exports = new TournamentModel();
