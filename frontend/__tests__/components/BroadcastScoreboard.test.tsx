import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import BroadcastScoreboard from "../../src/components/BroadcastScoreboard";

describe("BroadcastScoreboard Component", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("renders player nameplates, ratings, and wallet badges", () => {
		render(
			<BroadcastScoreboard
				whitePlayer="Alice"
				blackPlayer="Bob"
				whiteAddress="GCEXAMPLEWHITE123456"
				blackAddress="GBEXAMPLEBLACK987654"
				whiteRating={1650}
				blackRating={1720}
				wagerAmount="50"
			/>
		);

		expect(screen.getByText("Alice")).toBeInTheDocument();
		expect(screen.getByText("Bob")).toBeInTheDocument();
		expect(screen.getByText(/1650/)).toBeInTheDocument();
		expect(screen.getByText(/1720/)).toBeInTheDocument();
		expect(screen.getByTestId("wallet-badge-white")).toHaveTextContent("GCEX…3456");
		expect(screen.getByTestId("wallet-badge-black")).toHaveTextContent("GBEX…7654");
	});

	it("highlights active turn player with emerald border", () => {
		const { rerender } = render(
			<BroadcastScoreboard
				whitePlayer="Alice"
				blackPlayer="Bob"
				currentTurn="white"
			/>
		);

		expect(screen.getByTestId("player-card-white")).toHaveClass("border-emerald-500");
		expect(screen.getByTestId("player-card-black")).not.toHaveClass("border-emerald-500");

		rerender(
			<BroadcastScoreboard
				whitePlayer="Alice"
				blackPlayer="Bob"
				currentTurn="black"
			/>
		);

		expect(screen.getByTestId("player-card-white")).not.toHaveClass("border-emerald-500");
		expect(screen.getByTestId("player-card-black")).toHaveClass("border-emerald-500");
	});

	it("updates clock countdown every second on active turn", () => {
		render(
			<BroadcastScoreboard
				whitePlayer="Alice"
				blackPlayer="Bob"
				currentTurn="white"
				whiteTimeLeft={120}
				blackTimeLeft={120}
				totalSeconds={120}
			/>
		);

		expect(screen.getByTestId("clock-container-white")).toHaveTextContent("2:00");
		expect(screen.getByTestId("clock-container-black")).toHaveTextContent("2:00");

		act(() => {
			vi.advanceTimersByTime(2000);
		});

		expect(screen.getByTestId("clock-container-white")).toHaveTextContent("1:58");
		expect(screen.getByTestId("clock-container-black")).toHaveTextContent("2:00");
	});

	it("displays low-time alert styling and pulse when clock is below 10 seconds", () => {
		render(
			<BroadcastScoreboard
				whitePlayer="Alice"
				blackPlayer="Bob"
				currentTurn="white"
				whiteTimeLeft={8}
				blackTimeLeft={60}
				totalSeconds={60}
			/>
		);

		const clockContainer = screen.getByTestId("clock-container-white");
		expect(clockContainer).toHaveClass("animate-pulse");
		expect(clockContainer).toHaveClass("text-red-400");
	});

	it("renders material advantage differential accurately", () => {
		render(
			<BroadcastScoreboard
				whitePlayer="Alice"
				blackPlayer="Bob"
				whiteMaterialAdvantage={3}
				blackMaterialAdvantage={0}
			/>
		);

		const whiteAdvantage = screen.getByTestId("material-advantage-white");
		expect(whiteAdvantage).toHaveTextContent("+3");
		expect(screen.queryByTestId("material-advantage-black")).not.toBeInTheDocument();
	});

	it("displays disconnected player banner when player is disconnected", () => {
		render(
			<BroadcastScoreboard
				whitePlayer="Alice"
				blackPlayer="Bob"
				isWhiteDisconnected={true}
				isBlackDisconnected={false}
			/>
		);

		expect(screen.getByTestId("disconnect-banner-white")).toHaveTextContent("Player Disconnected");
		expect(screen.queryByTestId("disconnect-banner-black")).not.toBeInTheDocument();
	});

	it("renders game over state and suppresses active turn highlight", () => {
		render(
			<BroadcastScoreboard
				whitePlayer="Alice"
				blackPlayer="Bob"
				currentTurn="white"
				isGameOver={true}
				gameOverReason="Checkmate - Black wins"
			/>
		);

		expect(screen.getByTestId("game-over-banner")).toHaveTextContent("Checkmate - Black wins");
		expect(screen.getByTestId("player-card-white")).not.toHaveClass("border-emerald-500");
		expect(screen.getByTestId("player-card-black")).not.toHaveClass("border-emerald-500");
	});
});
