import { csrfFetch, API_URL } from "./gameApi";

/** Lifecycle status of a tournament, matching the planned backend schema. */
export type TournamentStatus = "open" | "active" | "completed" | "cancelled";

/** A tournament as returned by the backend API. */
export interface Tournament {
  id: string | number;
  title: string;
  /** Entry fee in XLM. */
  entry_fee: number;
  /** Total prize pool in XLM (typically entry_fee * max_players). */
  prize_pool: number;
  max_players: number;
  /** Registered player count. */
  participant_count?: number;
  status: TournamentStatus;
  /** ISO timestamp of tournament start; null until scheduled. */
  starts_at?: string | null;
  winner_address?: string | null;
  created_at?: string;
}

/** A registered player on a tournament. */
export interface TournamentParticipant {
  tournament_id: string | number;
  wallet_address: string;
  seed_number?: number | null;
  status?: string | null;
}

export type TournamentMatchStatus = "pending" | "ready" | "live" | "completed" | "bye" | "cancelled";

export interface TournamentBracketMatch {
  id: string;
  round: 1 | 2 | 3;
  position: number;
  player_one?: string | null;
  player_two?: string | null;
  winner?: string | null;
  status: TournamentMatchStatus;
  game_code?: string | null;
}

interface BackendBracketMatch extends Omit<TournamentBracketMatch, "position" | "status"> {
  position?: number;
  match_number?: number;
  match_order?: number;
  status: TournamentMatchStatus | "in_progress";
  winner_address?: string | null;
}

interface TournamentDetail extends Tournament {
  participants?: TournamentParticipant[];
  bracket_matches?: TournamentBracketMatch[];
}

type TournamentDetailResponse = Omit<TournamentDetail, "status" | "bracket_matches"> & {
  status: TournamentStatus | "in_progress";
  bracket_matches?: BackendBracketMatch[];
};

function normalizeBracketMatch(match: BackendBracketMatch, index: number): TournamentBracketMatch {
  return {
    ...match,
    position: match.position ?? match.match_number ?? match.match_order ?? index + 1,
    status: match.status === "in_progress" ? "live" : match.status,
    winner: match.winner ?? match.winner_address ?? null,
  };
}

/** Standard backend JSON envelope, shared with gameApi responses. */
interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
}

/**
 * Fetch tournaments, optionally filtered by status.
 * @param status - Omit or pass "all" to fetch every tournament.
 */
export const fetchTournaments = async (
  status: TournamentStatus | "all" = "all",
): Promise<Tournament[]> => {
  const url = status !== "all" ? `${API_URL}/tournaments?status=${status}` : `${API_URL}/tournaments`;
  const res = await fetch(url);
  if (!res.ok) {
    let errorMsg = `Server error (${res.status})`;
    try {
      const errJson = await res.json();
      if (errJson.error) errorMsg = errJson.error;
    } catch {
      // not JSON
    }
    throw new Error(errorMsg);
  }
  const json = (await res.json()) as ApiResponse<Tournament[]> & { tournaments?: Tournament[] };
  if (!json.success) throw new Error(json.error || "Failed to fetch tournaments");
  return json.data || json.tournaments || [];
};

/** Fetch a single tournament with its registered participants. */
export const fetchTournamentById = async (
  tournamentId: string | number,
): Promise<TournamentDetail> => {
  const res = await fetch(`${API_URL}/tournaments/${tournamentId}`);
  if (!res.ok) {
    let errorMsg = `Server error (${res.status})`;
    try {
      const errJson = await res.json();
      if (errJson.error) errorMsg = errJson.error;
    } catch {
      // not JSON
    }
    throw new Error(errorMsg);
  }
  const json = (await res.json()) as ApiResponse<TournamentDetailResponse> & {
    tournament?: TournamentDetailResponse;
  };
  if (!json.success) throw new Error(json.error || "Failed to fetch tournament");
  const tournament = json.data || json.tournament;
  if (!tournament) throw new Error("Missing tournament data");
  return {
    ...tournament,
    status: tournament.status === "in_progress" ? "active" : tournament.status,
    bracket_matches: Array.isArray(tournament.bracket_matches)
      ? tournament.bracket_matches.map(normalizeBracketMatch)
      : [],
  };
};

/**
 * Register the given wallet into a tournament. The backend moves XLM entry
 * fee into the Soroban escrow contract before confirming registration.
 */
export const joinTournament = async (
  tournamentId: string | number,
  walletAddress: string,
): Promise<TournamentParticipant> => {
  const res = await csrfFetch(`${API_URL}/tournaments/${tournamentId}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress }),
  });
  if (!res.ok) {
    let errorMsg = `Server error (${res.status})`;
    try {
      const errJson = await res.json();
      if (errJson.error) errorMsg = errJson.error;
    } catch {
      // not JSON
    }
    throw new Error(errorMsg);
  }
  const json = (await res.json()) as ApiResponse<TournamentParticipant> & { participant?: TournamentParticipant };
  if (!json.success) throw new Error(json.error || "Failed to join tournament");
  return json.data || json.participant!;
};
