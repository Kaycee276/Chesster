import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MoveList } from "../../src/components/MoveList";
import type { ReplayedMove } from "../../src/utils/pgnParser";

const STORAGE_KEY = "chesster:figurineNotation";

function move(color: "white" | "black", san: string): ReplayedMove {
	return {
		moveNumber: 1,
		color,
		san,
		from: [0, 0],
		to: [0, 0],
		piece: "n",
		isCapture: false,
		isCheck: false,
		isCheckmate: false,
		boardAfter: [],
	};
}

const MOVES: ReplayedMove[] = [
	move("white", "Nf3"),
	move("black", "Nc6"),
	move("white", "e4"),
	move("black", "Qh4"),
];

describe("MoveList figurine notation (Issue #661)", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it("shows piece letters by default", () => {
		render(<MoveList moves={MOVES} currentIndex={3} />);
		expect(screen.getByText("Nf3")).toBeInTheDocument();
		expect(screen.getByText("Nc6")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /figurine off/i })).toHaveAttribute("aria-pressed", "false");
	});

	it("switches to figurine glyphs when the toggle is pressed and saves the choice", () => {
		render(<MoveList moves={MOVES} currentIndex={3} />);

		fireEvent.click(screen.getByRole("button", { name: /figurine off/i }));

		expect(screen.getByText("♘f3")).toBeInTheDocument();
		expect(screen.getByText("♞c6")).toBeInTheDocument();
		expect(screen.getByText("e4")).toBeInTheDocument();
		expect(screen.getByText("♛h4")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /figurine on/i })).toHaveAttribute("aria-pressed", "true");
		expect(localStorage.getItem(STORAGE_KEY)).toBe("true");
	});

	it("switches back to letters when toggled again", () => {
		render(<MoveList moves={MOVES} currentIndex={3} />);

		fireEvent.click(screen.getByRole("button", { name: /figurine off/i }));
		fireEvent.click(screen.getByRole("button", { name: /figurine on/i }));

		expect(screen.getByText("Nf3")).toBeInTheDocument();
		expect(localStorage.getItem(STORAGE_KEY)).toBe("false");
	});

	it("starts with figurines on when the saved preference is on", () => {
		localStorage.setItem(STORAGE_KEY, "true");
		render(<MoveList moves={MOVES} currentIndex={3} />);
		expect(screen.getByText("♘f3")).toBeInTheDocument();
	});

	it("does not render the toggle when there are no moves", () => {
		render(<MoveList moves={[]} currentIndex={-1} />);
		expect(screen.queryByRole("button", { name: /figurine/i })).not.toBeInTheDocument();
		expect(screen.getByText("No moves played yet.")).toBeInTheDocument();
	});
});
