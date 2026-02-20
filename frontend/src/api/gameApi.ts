const BACKEND_URL =
	import.meta.env.VITE_BACKEND_URL || "http://localhost:3000/";
const API_URL = `${BACKEND_URL}api`;

export const api = {
	createGame: async (gameType = "chess", playerAddress?: string) => {
		const res = await fetch(`${API_URL}/games`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ gameType, playerWhiteAddress: playerAddress }),
		});
		return res.json();
	},

	joinGame: async (gameCode: string, playerColor: "white" | "black", playerAddress?: string) => {
		const res = await fetch(`${API_URL}/games/${gameCode}/join`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ playerColor, playerAddress }),
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
		promotion?: string
	) => {
		const res = await fetch(`${API_URL}/games/${gameCode}/move`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ from, to, promotion }),
		});
		return res.json();
	},

	getMoves: async (gameCode: string) => {
		const res = await fetch(`${API_URL}/games/${gameCode}/moves`);
		return res.json();
	},

	resignGame: async (gameCode: string, playerColor: 'white' | 'black') => {
		const res = await fetch(`${API_URL}/games/${gameCode}/resign`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ playerColor })
		});
		return res.json();
	},

	offerDraw: async (gameCode: string, playerColor: 'white' | 'black') => {
		const res = await fetch(`${API_URL}/games/${gameCode}/draw/offer`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ playerColor })
		});
		return res.json();
	},

	acceptDraw: async (gameCode: string) => {
		const res = await fetch(`${API_URL}/games/${gameCode}/draw/accept`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' }
		});
		return res.json();
	},
};
