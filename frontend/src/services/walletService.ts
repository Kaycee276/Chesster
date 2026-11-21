import { restoreWalletKitConnection } from "./walletKit";
import { Networks } from "@stellar/stellar-sdk";

const DEFAULT_NETWORK_PASSPHRASE =
	(import.meta.env.VITE_STELLAR_NETWORK_PASSPHRASE as string | undefined) || Networks.TESTNET;

export type SessionStatus = "connected" | "reauthenticating" | "disconnected";

export const LAST_WALLET_KEY = "chesster:last_wallet_type";
/** Refresh the access token this long before it expires (JWT lifetime 60m -> refresh at 50m). */
export const REFRESH_LEAD_MS = 10 * 60 * 1000;

const BACKEND_URL =
	((import.meta.env.VITE_BACKEND_URL as string | undefined) || "http://localhost:3000").replace(/\/+$/, "");

interface FreighterApi {
	isAllowed: () => Promise<boolean | { isAllowed: boolean }>;
	getPublicKey?: () => Promise<string | { publicKey?: string; address?: string }>;
}

export interface RestoredWallet {
	address: string;
	networkPassphrase: string;
	walletType: string;
}

let accessToken: string | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let inflightRefresh: Promise<boolean> | null = null;
let status: SessionStatus = "disconnected";
const listeners = new Set<(status: SessionStatus) => void>();

function setStatus(next: SessionStatus) {
	if (status === next) return;
	status = next;
	listeners.forEach((listener) => listener(next));
}

export function getSessionStatus(): SessionStatus {
	return status;
}

export function subscribeSessionStatus(listener: (status: SessionStatus) => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function getAccessToken(): string | null {
	return accessToken;
}

export function rememberWalletType(walletType: string | null) {
	try {
		if (walletType) localStorage.setItem(LAST_WALLET_KEY, walletType);
		else localStorage.removeItem(LAST_WALLET_KEY);
	} catch {
		/* storage unavailable */
	}
}

/**
 * Re-hydrates a previously authorized wallet without opening any popup.
 * Returns null when the user never authorized the app or the extension no
 * longer grants permission.
 */
export async function checkAutoConnect(): Promise<RestoredWallet | null> {
	let lastWallet: string | null = null;
	try {
		lastWallet = localStorage.getItem(LAST_WALLET_KEY);
	} catch {
		return null;
	}
	if (!lastWallet) return null;

	const freighter = (window as unknown as { freighterApi?: FreighterApi }).freighterApi;
	if (lastWallet.toLowerCase() === "freighter" && freighter) {
		try {
			const result = await freighter.isAllowed();
			const allowed = typeof result === "boolean" ? result : Boolean(result?.isAllowed);
			if (!allowed) return null;
			if (typeof freighter.getPublicKey === "function") {
				const pkResult = await freighter.getPublicKey();
				const publicKey =
					typeof pkResult === "string" ? pkResult : pkResult?.publicKey || pkResult?.address || "";
				if (publicKey) {
					return {
						address: publicKey,
						networkPassphrase: DEFAULT_NETWORK_PASSPHRASE,
						walletType: "freighter",
					};
				}
			}
		} catch {
			return null;
		}
	}
	return restoreWalletKitConnection();
}

export async function trySilentReconnect(): Promise<boolean> {
	const restored = await checkAutoConnect();
	return Boolean(restored);
}

function clearRefreshTimer() {
	if (refreshTimer) clearTimeout(refreshTimer);
	refreshTimer = null;
}

/** Stores a fresh access token and schedules the silent refresh. */
export function setAccessToken(token: string, expiresInMs: number) {
	accessToken = token;
	clearRefreshTimer();
	const delay = Math.max(0, expiresInMs - REFRESH_LEAD_MS);
	refreshTimer = setTimeout(() => {
		void refreshAccessToken();
	}, delay);
	setStatus("connected");
}

/** Marks a wallet session as active (e.g. after the wallet was re-hydrated). */
export function markConnected() {
	setStatus("connected");
}

/** Clears all cached credentials (clean logout). */
export function clearSession() {
	accessToken = null;
	clearRefreshTimer();
	inflightRefresh = null;
	rememberWalletType(null);
	setStatus("disconnected");
}

/**
 * Exchanges the HTTP-only refresh cookie for a new access token. Concurrent
 * callers share a single request. Resolves false when refresh was rejected.
 */
export function refreshAccessToken(): Promise<boolean> {
	if (inflightRefresh) return inflightRefresh;
	setStatus("reauthenticating");
	inflightRefresh = (async () => {
		try {
			const response = await fetch(`${BACKEND_URL}/api/auth/refresh`, {
				method: "POST",
				credentials: "include",
			});
			if (!response.ok) throw new Error(`Refresh failed with status ${response.status}`);
			const body = (await response.json()) as { token?: string; expiresIn?: number };
			if (!body.token) throw new Error("Refresh response missing token");
			const expiresInMs = Number(body.expiresIn) > 0 ? Number(body.expiresIn) * 1000 : 60 * 60 * 1000;
			setAccessToken(body.token, expiresInMs);
			return true;
		} catch {
			accessToken = null;
			clearRefreshTimer();
			setStatus("disconnected");
			return false;
		} finally {
			inflightRefresh = null;
		}
	})();
	return inflightRefresh;
}

/**
 * fetch wrapper that attaches the bearer token and, on a 401, attempts one
 * silent token refresh before retrying the request.
 */
export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
	const send = () => {
		const headers = new Headers(init.headers);
		if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
		return fetch(input, { ...init, headers });
	};
	const response = await send();
	if (response.status !== 401) return response;
	if (!(await refreshAccessToken())) return response;
	return send();
}
