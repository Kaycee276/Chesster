const API_URL = "http://10.106.245.79:3000/api";

export const api = {
	createGame: async (gameType = "chess") => {
		const res = await fetch(`${API_URL}/games`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ gameType }),
		});
		return res.json();
	},

	joinGame: async (gameCode: string, playerColor: "white" | "black") => {
		const res = await fetch(`${API_URL}/games/${gameCode}/join`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ playerColor }),
		});
		return res.json();
	},

	getGame: async (gameCode: string) => {
		const res = await fetch(`${API_URL}/games/${gameCode}`);
		return res.json();
	},

	makeMove: async (
		gameCode: string,
		from: [number, number],
		to: [number, number],
	) => {
		const res = await fetch(`${API_URL}/games/${gameCode}/move`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ from, to }),
		});
		return res.json();
	},

	getMoves: async (gameCode: string) => {
		const res = await fetch(`${API_URL}/games/${gameCode}/moves`);
		return res.json();
	},
};
