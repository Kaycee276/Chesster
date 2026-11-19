import { API_URL } from "./gameApi";

export interface Puzzle {
	id: string;
	fen: string; // initial position
	sideToMove: "white" | "black"; // which side must find the winning move
	solution: Array<{ from: [number, number]; to: [number, number]; promotion?: string }>;
	rating: number; // puzzle difficulty rating
	themes: string[]; // e.g. ["Fork", "Pin", "Discovered Attack"]
	title?: string;
	description?: string;
}

export const puzzleApi = {
  fetchAdaptivePuzzle: async (targetRating: number, excludeId?: string, signal?: AbortSignal): Promise<Puzzle> => {
    const query = new URLSearchParams({ targetRating: String(Math.round(targetRating)), range: "100" });
    if (excludeId) query.set("excludeId", excludeId);
    const res = await fetch(`${API_URL}/puzzles/adaptive?${query}`, { signal });
    if (!res.ok) throw new Error(`Failed to fetch puzzle: ${res.statusText}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || "Failed to fetch puzzle");
    const puzzle = json.data as Puzzle;
    if (!puzzle || !Number.isFinite(puzzle.rating) || !Array.isArray(puzzle.solution) || !puzzle.solution.length) {
      throw new Error("The puzzle response is incomplete. Please try again.");
    }
    return puzzle;
  },
	fetchDailyPuzzle: async (): Promise<Puzzle> => {
		const res = await fetch(`${API_URL}/puzzles/daily`);
		if (!res.ok) {
			throw new Error(`Failed to fetch daily puzzle: ${res.statusText}`);
		}
		const json = await res.json();
		if (!json.success) {
			throw new Error(json.error || "Failed to fetch daily puzzle");
		}
		return json.data as Puzzle;
	},
};
