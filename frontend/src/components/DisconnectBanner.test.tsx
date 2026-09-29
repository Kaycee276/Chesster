import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import DisconnectBanner from "./DisconnectBanner";
import { useGraceCountdown } from "../hooks/useGraceCountdown";

afterEach(cleanup);

function HookProbe({ seconds }: { seconds: number }) {
	const remaining = useGraceCountdown(seconds);
	return <p data-testid="probe">{remaining}</p>;
}

describe("DisconnectBanner (#317)", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("renders the countdown text with the opponent name", () => {
		render(
			<DisconnectBanner
				opponentName="Opponent (black)"
				graceSeconds={45}
				totalSeconds={60}
				reconnected={false}
				onClaimWin={vi.fn()}
				onDismiss={vi.fn()}
			/>,
		);

		expect(
			screen.getByText(/45s remaining/),
		).toBeInTheDocument();
		expect(screen.getByRole("alert")).toBeInTheDocument();
		// The claim button must not exist while time remains.
		expect(
			screen.queryByRole("button", { name: /claim win/i }),
		).not.toBeInTheDocument();
	});

	it("decrements smoothly each second via the countdown hook", () => {
		render(<HookProbe seconds={3} />);

		expect(screen.getByTestId("probe")).toHaveTextContent("3");
		act(() => {
			vi.advanceTimersByTime(1000);
		});
		expect(screen.getByTestId("probe")).toHaveTextContent("2");
		act(() => {
			vi.advanceTimersByTime(1000);
		});
		expect(screen.getByTestId("probe")).toHaveTextContent("1");
		act(() => {
			vi.advanceTimersByTime(1000);
		});
		expect(screen.getByTestId("probe")).toHaveTextContent("0");
		// Clamps at zero instead of counting into negatives.
		act(() => {
			vi.advanceTimersByTime(1000);
		});
		expect(screen.getByTestId("probe")).toHaveTextContent("0");
	});

	it("shows the Claim Win button once the countdown reaches 0", () => {
		const onClaimWin = vi.fn();

		render(
			<DisconnectBanner
				opponentName="Opponent (white)"
				graceSeconds={0}
				totalSeconds={60}
				reconnected={false}
				onClaimWin={onClaimWin}
				onDismiss={vi.fn()}
			/>,
		);

		const claimButton = screen.getByRole("button", { name: /claim win/i });
		expect(claimButton).toBeInTheDocument();

		fireEvent.click(claimButton);
		expect(onClaimWin).toHaveBeenCalledOnce();
	});

	it("shows the reconnected badge and dismisses itself", async () => {
		const onDismiss = vi.fn();

		render(
			<DisconnectBanner
				opponentName="Opponent (black)"
				graceSeconds={60}
				totalSeconds={60}
				reconnected
				onClaimWin={vi.fn()}
				onDismiss={onDismiss}
			/>,
		);

		expect(screen.getByRole("status")).toHaveTextContent(/reconnected/i);

		act(() => {
			vi.advanceTimersByTime(2500);
		});
		expect(onDismiss).toHaveBeenCalledOnce();
	});
});
