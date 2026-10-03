import { csrfFetch } from "./gameApi";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:3000/";
const API_URL = `${BACKEND_URL}api`;

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

export type TournamentMatchStatus = "pending" | "ready" | "live" | "completed";

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
  const res = await fetch(
    status !== "all" ? `${API_URL}/tournaments?status=${status}` : `${API_URL}/tournaments`,
  );
  const json: ApiResponse<Tournament[]> = await res.json();
  if (!json.success) throw new Error(json.error || "Failed to fetch tournaments");
  return json.data;
};

/** Fetch a single tournament with its registered participants. */
export const fetchTournamentById = async (
  tournamentId: string | number,
): Promise<
  Tournament & {
    participants?: TournamentParticipant[];
    bracket_matches?: TournamentBracketMatch[];
  }
> => {
  const res = await fetch(`${API_URL}/tournaments/${tournamentId}`);
  const json: ApiResponse<
    Tournament & {
      participants?: TournamentParticipant[];
      bracket_matches?: TournamentBracketMatch[];
    }
  > = await res.json();
  if (!json.success) throw new Error(json.error || "Failed to fetch tournament");
  return json.data;
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
  const json: ApiResponse<TournamentParticipant> = await res.json();
  if (!json.success) throw new Error(json.error || "Failed to join tournament");
  return json.data;
};
