const BACKEND_URL =
	import.meta.env.VITE_BACKEND_URL || "http://localhost:3000/";
const API_URL = `${BACKEND_URL}api`;

function getCsrfToken() {
	return document.cookie
		.split(";")
		.map((cookie) => cookie.trim())
		.find((cookie) => cookie.startsWith("XSRF-TOKEN="))
		?.split("=")[1];
}

export async function csrfFetch(url: string, init: RequestInit = {}) {
	let token = getCsrfToken();
	if (!token) {
		await fetch(`${API_URL}/csrf-token`, { credentials: "include" });
		token = getCsrfToken();
	}
	const headers = new Headers(init.headers);
	headers.set("X-XSRF-TOKEN", decodeURIComponent(token ?? ""));
	return fetch(url, { ...init, headers, credentials: "include" });
}

export const api = {
	createGame: async (
		gameType = "chess",
		playerAddress?: string,
		wagerAmount?: string,
		timeControlSeconds?: number,
		gameCode?: string,
		timeIncrementSeconds?: number,
	) => {
		const res = await csrfFetch(`${API_URL}/games`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				gameType,
				playerWhiteAddress: playerAddress,
				wagerAmount: wagerAmount ? parseFloat(wagerAmount) : undefined,
				timeControlSeconds: timeControlSeconds ?? 600,
				timeIncrementSeconds: timeIncrementSeconds ?? 0,
				gameCode,
			}),
		});
		return res.json();
	},

	joinGame: async (
		gameCode: string,
		playerColor: "white" | "black",
		playerAddress?: string,
	) => {
		const res = await csrfFetch(`${API_URL}/games/${gameCode}/join`, {
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

	getPendingGames: async () => {
		const res = await fetch(`${API_URL}/games/pending`);
		return res.json();
	},

	makeMove: async (
		gameCode: string,
		from: [number, number],
		to: [number, number],
		promotion?: string,
	) => {
		const res = await csrfFetch(`${API_URL}/games/${gameCode}/move`, {
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

	resignGame: async (gameCode: string, playerColor: "white" | "black") => {
		const res = await csrfFetch(`${API_URL}/games/${gameCode}/resign`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ playerColor }),
		});
		return res.json();
	},

	offerDraw: async (gameCode: string, playerColor: "white" | "black", playerAddress?: string) => {
		const res = await csrfFetch(`${API_URL}/games/${gameCode}/draw/offer`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ playerColor, playerAddress }),
		});
		return res.json();
	},

	acceptDraw: async (gameCode: string) => {
		const res = await csrfFetch(`${API_URL}/games/${gameCode}/draw/accept`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
		});
		return res.json();
	},

	getChatHistory: async (gameCode: string) => {
		const res = await fetch(`${API_URL}/games/${gameCode}/chat`);
		return res.json();
	},
};
