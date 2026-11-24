import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import BroadcastScoreboard from "../../src/components/BroadcastScoreboard";

const players = {
	whitePlayer: "Alice",
	blackPlayer: "Bob",
} as const;

describe("BroadcastScoreboard", () => {
	it("renders both nameplates and highlights the player whose turn it is", () => {
		const { rerender } = render(<BroadcastScoreboard {...players} currentTurn="white" />);

		expect(screen.getByRole("group", { name: "White player, active turn" })).toHaveClass("border-emerald-500");
		expect(screen.getByRole("group", { name: "Black player" })).toHaveClass("border-white/15");
		expect(screen.getByRole("group", { name: "White player, active turn" })).toHaveAttribute("aria-current", "true");
		expect(screen.getByRole("group", { name: "Black player" })).toHaveAttribute("data-active", "false");

		rerender(<BroadcastScoreboard {...players} currentTurn="black" />);

		expect(screen.getByRole("group", { name: "White player" })).toHaveClass("border-white/15");
		expect(screen.getByRole("group", { name: "Black player, active turn" })).toHaveClass("border-emerald-500");
		expect(screen.getByRole("group", { name: "Black player, active turn" })).toHaveAttribute("aria-current", "true");
		expect(screen.getByRole("group", { name: "White player" })).toHaveAttribute("data-active", "false");
	});

	it("formats both clocks and flags low-time styling under ten seconds", () => {
		const { rerender } = render(
			<BroadcastScoreboard
				{...players}
				currentTurn="white"
				whiteSecondsLeft={125}
				blackSecondsLeft={60}
				totalSeconds={300}
			/>,
		);

		expect(screen.getByRole("timer", { name: "Time remaining: 2:05" })).toBeInTheDocument();
		expect(screen.getByRole("timer", { name: "Time remaining: 1:00" })).toBeInTheDocument();
		expect(screen.getByRole("group", { name: "White player, active turn" })).not.toHaveAttribute("data-low-time");

		rerender(
			<BroadcastScoreboard
				{...players}
				currentTurn="white"
				whiteSecondsLeft={9}
				blackSecondsLeft={60}
				totalSeconds={300}
			/>,
		);

		const timer = screen.getByRole("timer", { name: "Low time warning: 9 seconds remaining" });
		expect(timer).toHaveClass("border-red-500");
		expect(screen.getByRole("group", { name: "White player, active turn" })).toHaveAttribute("data-low-time", "true");
	});

	it("does not render clocks when the overlay option is disabled", () => {
		render(<BroadcastScoreboard {...players} currentTurn="white" whiteSecondsLeft={30} showClocks={false} />);

		expect(screen.queryByRole("timer")).not.toBeInTheDocument();
	});

	it("shows the material advantage differential on the leading player", () => {
		const { rerender } = render(<BroadcastScoreboard {...players} currentTurn="white" materialAdvantage={3} />);

		expect(screen.getByText("+3")).toHaveAccessibleName("White material advantage: +3");
		expect(screen.getByRole("group", { name: "Black player" })).not.toHaveTextContent("+3");

		rerender(<BroadcastScoreboard {...players} currentTurn="white" materialAdvantage={-5} />);

		expect(screen.getByText("−5")).toHaveAccessibleName("Black material advantage: −5");
		expect(screen.getByRole("group", { name: "White player, active turn" })).not.toHaveTextContent("−5");
	});

	it("announces a disconnected player", () => {
		render(<BroadcastScoreboard {...players} currentTurn="white" disconnected="black" />);

		expect(screen.getByRole("status")).toHaveTextContent("Black disconnected");
		expect(screen.getByRole("group", { name: "Black player" })).toHaveAttribute("data-disconnected", "true");
	});

	it("announces checkmate, resignation and draw outcomes", () => {
		const { rerender } = render(
			<BroadcastScoreboard {...players} currentTurn="black" gameOver={{ result: "checkmate", winner: "white" }} />,
		);

		expect(screen.getByRole("status")).toHaveTextContent("White wins by checkmate");
		expect(screen.getByRole("group", { name: "White player" })).toHaveAttribute("data-winner", "true");
		expect(screen.getByRole("group", { name: "Black player, active turn" })).not.toHaveAttribute("data-winner");

		rerender(
			<BroadcastScoreboard {...players} currentTurn="white" gameOver={{ result: "resignation", winner: "black" }} />,
		);
		expect(screen.getByRole("status")).toHaveTextContent("Black wins by resignation");

		rerender(<BroadcastScoreboard {...players} currentTurn="white" gameOver={{ result: "draw" }} />);
		expect(screen.getByRole("status")).toHaveTextContent("Draw");
	});

	it("renders profile metadata and wallet badges for object players", () => {
		render(
			<BroadcastScoreboard
				whitePlayer={{ name: "Alice", rating: 1820, address: "GABCDEFGHIJKLMNOP", wager: 25 }}
				blackPlayer={{ name: "Bob", rating: 1790, address: "GZYXWVUTSRQPONMLK" }}
				currentTurn="white"
			/>,
		);

		expect(screen.getByRole("group", { name: "White player, active turn" })).toHaveTextContent("Alice");
		expect(screen.getByRole("group", { name: "White player, active turn" })).toHaveTextContent("White · 1820 · GABC…MNOP · 25 XLM");
		expect(screen.getByRole("group", { name: "Black player" })).toHaveTextContent("Black · 1790 · GZYX…NMLK");
	});
});
