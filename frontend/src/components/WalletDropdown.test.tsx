import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const restore = vi.fn();
vi.mock("../services/walletKit", () => ({
	connectWithWalletKit: vi.fn(),
	disconnectWalletKit: vi.fn().mockResolvedValue(undefined),
	restoreWalletKitConnection: (...args: unknown[]) => restore(...args),
}));
vi.mock("../services/stellarService", () => ({
	fetchAccountBalances: vi.fn().mockResolvedValue([{ assetCode: "XLM", balance: "12.5" }]),
}));

import WalletDropdown from "./WalletDropdown";
import { useWalletStore } from "../store/walletStore";
import {
	LAST_WALLET_KEY,
	REFRESH_LEAD_MS,
	authFetch,
	checkAutoConnect,
	clearSession,
	getAccessToken,
	getSessionStatus,
	setAccessToken,
	trySilentReconnect,
} from "../services/walletService";

const wallet = { address: "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW", networkPassphrase: "net", walletType: "freighter" };

function renderDropdown() {
	return render(
		<MemoryRouter>
			<WalletDropdown />
		</MemoryRouter>,
	);
}

describe("wallet silent session recovery", () => {
	beforeEach(() => {
		localStorage.clear();
		restore.mockReset();
		clearSession();
		useWalletStore.setState({ address: null, isConnected: false, walletType: null, networkPassphrase: null });
		delete (window as unknown as { freighterApi?: unknown }).freighterApi;
	});
	afterEach(() => {
		cleanup();
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("does nothing when no wallet was previously authorized", async () => {
		expect(await checkAutoConnect()).toBeNull();
		expect(restore).not.toHaveBeenCalled();
	});

	it("re-hydrates an allowed Freighter wallet without a popup", async () => {
		localStorage.setItem(LAST_WALLET_KEY, "freighter");
		const isAllowed = vi.fn().mockResolvedValue(true);
		(window as unknown as { freighterApi: unknown }).freighterApi = { isAllowed };
		restore.mockResolvedValue(wallet);

		expect(await checkAutoConnect()).toEqual(wallet);
		expect(isAllowed).toHaveBeenCalled();
	});

	it("hydrates directly when freighterApi.getPublicKey is available via trySilentReconnect", async () => {
		localStorage.setItem(LAST_WALLET_KEY, "freighter");
		const isAllowed = vi.fn().mockResolvedValue(true);
		const getPublicKey = vi.fn().mockResolvedValue(wallet.address);
		(window as unknown as { freighterApi: unknown }).freighterApi = { isAllowed, getPublicKey };

		expect(await trySilentReconnect()).toBe(true);
		expect(getPublicKey).toHaveBeenCalled();
		expect(restore).not.toHaveBeenCalled();
	});

	it("skips reconnect when Freighter permission was revoked", async () => {
		localStorage.setItem(LAST_WALLET_KEY, "freighter");
		(window as unknown as { freighterApi: unknown }).freighterApi = { isAllowed: vi.fn().mockResolvedValue({ isAllowed: false }) };

		expect(await checkAutoConnect()).toBeNull();
		expect(restore).not.toHaveBeenCalled();
	});

	it("treats a throwing permission check as not allowed", async () => {
		localStorage.setItem(LAST_WALLET_KEY, "freighter");
		(window as unknown as { freighterApi: unknown }).freighterApi = { isAllowed: vi.fn().mockRejectedValue(new Error("boom")) };
		expect(await checkAutoConnect()).toBeNull();
	});

	it("restores the wallet on app load and shows the Connected indicator", async () => {
		localStorage.setItem(LAST_WALLET_KEY, "lobstr");
		restore.mockResolvedValue({ ...wallet, walletType: "lobstr" });
		await useWalletStore.getState().checkConnection();
		renderDropdown();

		const indicator = await screen.findByTestId("session-status");
		expect(indicator).toHaveAttribute("data-status", "connected");
		expect(indicator).toHaveAttribute("aria-label", "Connected");
	});

	it("stays on the connect button when nothing can be restored", async () => {
		await useWalletStore.getState().checkConnection();
		renderDropdown();
		expect(useWalletStore.getState().sessionStatus).toBe("disconnected");
		expect(screen.getByRole("button", { name: "Connect wallet" })).toBeInTheDocument();
		expect(screen.queryByTestId("session-status")).toBeNull();
	});

	it("clears cached credentials on disconnect", () => {
		localStorage.setItem(LAST_WALLET_KEY, "freighter");
		setAccessToken("tok", 3600_000);
		useWalletStore.getState().disconnect();

		expect(localStorage.getItem(LAST_WALLET_KEY)).toBeNull();
		expect(getAccessToken()).toBeNull();
		expect(getSessionStatus()).toBe("disconnected");
	});
});

describe("token refresh", () => {
	beforeEach(() => {
		clearSession();
	});
	afterEach(() => {
		clearSession();
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("refreshes silently 10 minutes before a one hour token expires", async () => {
		vi.useFakeTimers();
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ token: "fresh", expiresIn: 3600 }), { status: 200 }),
		);
		vi.stubGlobal("fetch", fetchMock);

		setAccessToken("old", 3600_000);
		await vi.advanceTimersByTimeAsync(3600_000 - REFRESH_LEAD_MS - 1000);
		expect(fetchMock).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1000);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/auth\/refresh$/);
		expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST", credentials: "include" });
		expect(getAccessToken()).toBe("fresh");
		expect(getSessionStatus()).toBe("connected");
	});

	it("retries a 401 once with a refreshed token", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(new Response("", { status: 401 }))
			.mockResolvedValueOnce(new Response(JSON.stringify({ token: "fresh", expiresIn: 3600 }), { status: 200 }))
			.mockResolvedValueOnce(new Response("ok", { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);
		setAccessToken("old", 3600_000);

		const response = await authFetch("/api/games");

		expect(response.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledTimes(3);
		const retryHeaders = fetchMock.mock.calls[2][1].headers as Headers;
		expect(retryHeaders.get("Authorization")).toBe("Bearer fresh");
	});

	it("shares one refresh request across concurrent 401s", async () => {
		const fetchMock = vi.fn(async (url: string) => {
			if (String(url).endsWith("/api/auth/refresh")) {
				return new Response(JSON.stringify({ token: "fresh", expiresIn: 3600 }), { status: 200 });
			}
			return new Response("", { status: getAccessToken() === "fresh" ? 200 : 401 });
		});
		vi.stubGlobal("fetch", fetchMock);
		setAccessToken("old", 3600_000);

		const results = await Promise.all([authFetch("/a"), authFetch("/b"), authFetch("/c")]);

		expect(results.every((r) => r.status === 200)).toBe(true);
		expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith("/api/auth/refresh"))).toHaveLength(1);
	});

	it("returns the 401 and marks the session disconnected when refresh fails", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(new Response("", { status: 401 }))
			.mockResolvedValueOnce(new Response("", { status: 401 }));
		vi.stubGlobal("fetch", fetchMock);
		setAccessToken("old", 3600_000);

		const response = await authFetch("/api/games");

		expect(response.status).toBe(401);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(getAccessToken()).toBeNull();
		expect(getSessionStatus()).toBe("disconnected");
	});

	it("passes non-401 responses through without refreshing", async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));
		vi.stubGlobal("fetch", fetchMock);
		const response = await authFetch("/api/games");
		expect(response.status).toBe(500);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
