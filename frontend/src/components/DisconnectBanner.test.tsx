import { useState } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import DisconnectBanner from "./DisconnectBanner";
import { useGraceCountdown } from "../hooks/useGraceCountdown";

const defaults = {
	opponentName: "Opponent (black)",
	graceSeconds: 30,
	totalSeconds: 30,
	reconnected: false,
	onClaimWin: vi.fn(),
	onDismiss: vi.fn(),
};

// The parent owns visibility and supplies the server's grace period.
function ConnectionFlow({ connected, seconds = 30 }: { connected: boolean; seconds?: number }) {
	const remaining = useGraceCountdown(connected ? 0 : seconds);
	const [dismissed, setDismissed] = useState(false);
	if (dismissed) return null;
	return (
		<DisconnectBanner
			{...defaults}
			graceSeconds={remaining}
			totalSeconds={seconds}
			reconnected={connected}
			onDismiss={() => setDismissed(true)}
		/>
	);
}

function bar() {
	return screen.getByRole("alert").querySelector<HTMLElement>("[style]")!;
}

describe("DisconnectBanner connection and countdown states", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.clearAllMocks();
	});

	afterEach(() => {
		cleanup();
		vi.useRealTimers();
	});

	it("renders the warning, opponent name and accessible countdown", () => {
		render(<DisconnectBanner {...defaults} />);
		expect(screen.getByRole("alert")).toHaveClass("border-amber-500/60", "bg-amber-950/80");
		expect(screen.getByText(/Opponent \(black\) disconnected/)).toHaveTextContent("30s remaining");
		expect(screen.getByText("30 seconds remaining before you can claim the win.")).toHaveAttribute("aria-live", "polite");
		expect(screen.queryByRole("button")).not.toBeInTheDocument();
		expect(bar()).toHaveStyle({ width: "100%" });
	});

	it("counts down from 30 seconds, expires and stays at zero", () => {
		render(<ConnectionFlow connected={false} />);
		for (let seconds = 29; seconds >= 1; seconds--) {
			act(() => vi.advanceTimersByTime(1000));
			expect(screen.getByText(new RegExp(`${seconds}s remaining`))).toBeInTheDocument();
		}
		expect(bar()).toHaveStyle({ width: `${100 / 30}%` });
		act(() => vi.advanceTimersByTime(1000));
		expect(screen.getByRole("button", { name: "Claim Win" })).toBeInTheDocument();
		expect(bar()).toHaveStyle({ width: "0%" });
		act(() => vi.advanceTimersByTime(5000));
		expect(screen.getByText(/Grace period expired\. You may claim/)).toBeInTheDocument();
	});

	it("invokes the claim callback only when the player clicks", () => {
		render(<DisconnectBanner {...defaults} graceSeconds={0} />);
		expect(defaults.onClaimWin).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Claim Win" }));
		expect(defaults.onClaimWin).toHaveBeenCalledOnce();
	});

	it.each([
		[15, 30, "50%"],
		[90, 30, "100%"],
		[-1, 30, "0%"],
		[30, 0, "0%"],
		[30, -1, "0%"],
	])("clamps progress for %s seconds remaining out of %s", (graceSeconds, totalSeconds, width) => {
		render(<DisconnectBanner {...defaults} graceSeconds={graceSeconds} totalSeconds={totalSeconds} />);
		expect(bar()).toHaveStyle({ width });
	});

	it("replaces the warning with a success badge and dismisses after reconnection", () => {
		const { rerender } = render(<ConnectionFlow connected={false} />);
		act(() => vi.advanceTimersByTime(1000));
		rerender(<ConnectionFlow connected />);
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
		expect(screen.getByRole("status")).toHaveClass("border-green-500/60");
		expect(screen.getByRole("status")).toHaveTextContent("Opponent (black) reconnected");
		act(() => vi.advanceTimersByTime(2499));
		expect(screen.getByRole("status")).toBeInTheDocument();
		act(() => vi.advanceTimersByTime(1));
		expect(screen.queryByRole("status")).not.toBeInTheDocument();
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
	});

	it("cancels dismissal if the opponent disconnects again", () => {
		const { rerender } = render(<DisconnectBanner {...defaults} reconnected />);
		act(() => vi.advanceTimersByTime(1000));
		rerender(<DisconnectBanner {...defaults} />);
		act(() => vi.advanceTimersByTime(3000));
		expect(defaults.onDismiss).not.toHaveBeenCalled();
		expect(screen.getByRole("alert")).toBeInTheDocument();
	});

	it("clears the dismissal timer on unmount", () => {
		const { unmount } = render(<DisconnectBanner {...defaults} reconnected />);
		unmount();
		act(() => vi.advanceTimersByTime(2500));
		expect(defaults.onDismiss).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});

	it("restarts the countdown when a new server grace period arrives", () => {
		const { rerender, unmount } = render(<ConnectionFlow connected={false} seconds={3} />);
		act(() => vi.advanceTimersByTime(1000));
		expect(screen.getByText(/2s remaining/)).toBeInTheDocument();
		rerender(<ConnectionFlow connected={false} seconds={30} />);
		expect(screen.getByText(/30s remaining/)).toBeInTheDocument();
		unmount();
		expect(vi.getTimerCount()).toBe(0);
	});
});
