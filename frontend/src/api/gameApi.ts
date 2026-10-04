const RAW_BACKEND_URL =
	(import.meta.env.VITE_BACKEND_URL as string | undefined) || "http://localhost:3000";
export const BACKEND_URL = RAW_BACKEND_URL.replace(/\/+$/, "");
export const API_URL = `${BACKEND_URL}/api`;

let inMemoryCsrfToken: string | null = null;
let pendingCsrfPromise: Promise<string | null> | null = null;

function getCookieCsrfToken(): string | undefined {
	if (typeof document === "undefined") return undefined;
	return document.cookie
		.split(";")
		.map((cookie) => cookie.trim())
		.find((cookie) => cookie.startsWith("XSRF-TOKEN="))
		?.split("=")[1];
}

export async function fetchCsrfToken(): Promise<string | null> {
	if (pendingCsrfPromise) return pendingCsrfPromise;

	pendingCsrfPromise = (async () => {
		try {
			const res = await fetch(`${API_URL}/csrf-token`, { credentials: "include" });
			if (res.ok) {
				const data = await res.json();
				const token = data.token || data.csrfToken || getCookieCsrfToken() || null;
				if (token) {
					inMemoryCsrfToken = token;
				}
				return inMemoryCsrfToken;
			}
		} catch (err) {
			console.warn("Failed to fetch CSRF token:", err);
		} finally {
			pendingCsrfPromise = null;
		}
		return inMemoryCsrfToken || getCookieCsrfToken() || null;
	})();

	return pendingCsrfPromise;
}

export async function getCsrfToken(): Promise<string | null> {
	if (inMemoryCsrfToken) return inMemoryCsrfToken;
	const cookieToken = getCookieCsrfToken();
	if (cookieToken) {
		inMemoryCsrfToken = cookieToken;
		return inMemoryCsrfToken;
	}
	return await fetchCsrfToken();
}

export async function csrfFetch(url: string, init: RequestInit = {}): Promise<Response> {
	let token = await getCsrfToken();

	const headers = new Headers(init.headers);
	if (token) {
		headers.set("X-XSRF-TOKEN", decodeURIComponent(token));
	}

	let response = await fetch(url, { ...init, headers, credentials: "include" });

	// If 403 Forbidden, token might be expired or missing in cross-origin setting; retry once with a freshly fetched token
	if (response.status === 403) {
		inMemoryCsrfToken = null;
		const freshToken = await fetchCsrfToken();
		if (freshToken) {
			const retryHeaders = new Headers(init.headers);
			retryHeaders.set("X-XSRF-TOKEN", decodeURIComponent(freshToken));
			response = await fetch(url, { ...init, headers: retryHeaders, credentials: "include" });
		}
	}

	return response;
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
