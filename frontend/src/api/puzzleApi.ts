const BACKEND_URL =
	import.meta.env.VITE_BACKEND_URL || "http://localhost:3000/";
const API_URL = `${BACKEND_URL}api`;

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
