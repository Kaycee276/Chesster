import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import NetworkBanner from "./NetworkBanner";

const state = vi.hoisted(() => ({
	socketStatus: "connected",
	pingMs: 0,
	reconnectAttempts: 6,
}));
const connect = vi.hoisted(() => vi.fn());
const getSocket = vi.hoisted(() => vi.fn());
vi.mock("../store/gameStore", () => ({ useGameStore: (select: (s: typeof state) => unknown) => select(state) }));
vi.mock("../store/walletStore", () => ({ useWalletStore: (select: (s: { isConnected: boolean }) => unknown) => select({ isConnected: false }) }));
vi.mock("../store/toastStore", () => ({ useToastStore: (select: (s: { addToast: () => void }) => unknown) => select({ addToast: vi.fn() }) }));
vi.mock("../api/socket", () => ({ socketService: { getSocket } }));
vi.mock("../services/walletKit", () => ({ getWalletNetwork: vi.fn() }));

describe("NetworkBanner socket reconnection", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.clearAllMocks();
		state.socketStatus = "connected";
		state.reconnectAttempts = 6;
		getSocket.mockReturnValue({ connect });
		vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
	});
	afterEach(() => {
		cleanup();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("hides the warning when the socket is healthy", () => {
		const { container } = render(<NetworkBanner />);
		expect(container).toBeEmptyDOMElement();
		expect(screen.queryByRole("button", { name: "Reconnect Now" })).not.toBeInTheDocument();
	});

	it("shows a warning and manually reconnects a disconnected socket", () => {
		state.socketStatus = "disconnected";
		render(<NetworkBanner />);
		expect(screen.getByText("Connection lost").parentElement).toHaveClass("bg-yellow-600");
		fireEvent.click(screen.getByRole("button", { name: "Reconnect Now" }));
		expect(connect).toHaveBeenCalledOnce();
	});

	it("counts down the maximum 30 second backoff and stops at zero", () => {
		state.socketStatus = "reconnecting";
		render(<NetworkBanner />);
		act(() => vi.advanceTimersByTime(0));
		expect(screen.getByText("Next attempt in 30s")).toBeInTheDocument();
		act(() => vi.advanceTimersByTime(1000));
		expect(screen.getByText("Next attempt in 29s")).toBeInTheDocument();
		act(() => vi.advanceTimersByTime(29000));
		expect(screen.queryByText(/Next attempt/)).not.toBeInTheDocument();
		act(() => vi.advanceTimersByTime(5000));
		expect(screen.queryByText(/Next attempt/)).not.toBeInTheDocument();
	});

	it("removes the warning and timers when the socket reconnects", () => {
		state.socketStatus = "reconnecting";
		const { rerender } = render(<NetworkBanner />);
		act(() => vi.advanceTimersByTime(0));
		state.socketStatus = "connected";
		rerender(<NetworkBanner />);
		expect(screen.queryByRole("button", { name: "Reconnect Now" })).not.toBeInTheDocument();
		expect(vi.getTimerCount()).toBe(0);
	});

	it("handles a socket that was disposed before manual retry", () => {
		state.socketStatus = "disconnected";
		getSocket.mockReturnValue(null);
		render(<NetworkBanner />);
		fireEvent.click(screen.getByRole("button", { name: "Reconnect Now" }));
		expect(connect).not.toHaveBeenCalled();
	});

	it("clears the backoff interval when unmounted", () => {
		state.socketStatus = "reconnecting";
		const { unmount } = render(<NetworkBanner />);
		unmount();
		expect(vi.getTimerCount()).toBe(0);
	});
});
