import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import BoardEditor from "../BoardEditor";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function fenValue(): string {
	return (screen.getByLabelText("FEN position") as HTMLInputElement).value;
}

function place(pieceTestId: string, row: number, col: number) {
	fireEvent.click(screen.getByTestId(pieceTestId));
	fireEvent.click(screen.getByTestId(`editor-square-${row}-${col}`));
}

describe("BoardEditor (#757)", () => {
	it("opens on the starting position and renders both palettes", () => {
		render(<BoardEditor onApply={vi.fn()} onClose={vi.fn()} />);

		expect(screen.getByRole("dialog", { name: "Board Editor" })).toBeInTheDocument();
		expect(fenValue()).toBe(START_FEN);
		expect(screen.getByTestId("editor-piece-K")).toBeInTheDocument();
		expect(screen.getByTestId("editor-piece-k")).toBeInTheDocument();
		expect(screen.getByText("Position is valid")).toBeInTheDocument();
	});

	it("places a palette piece on a square and updates the FEN", () => {
		render(<BoardEditor onApply={vi.fn()} onClose={vi.fn()} />);

		place("editor-piece-Q", 4, 4);

		expect(fenValue()).toContain("4Q3");
	});

	it("moves a piece by drag-and-drop", () => {
		render(<BoardEditor onApply={vi.fn()} onClose={vi.fn()} />);
		const data = new Map<string, string>();
		const dataTransfer = {
			setData: (key: string, value: string) => data.set(key, value),
			getData: (key: string) => data.get(key) ?? "",
			effectAllowed: "",
		};

		fireEvent.dragStart(screen.getByTestId("editor-piece-N"), { dataTransfer });
		fireEvent.drop(screen.getByTestId("editor-square-4-4"), { dataTransfer });

		expect(fenValue()).toContain("4N3");
	});

	it("updates turn, castling, en passant and halfmove fields", () => {
		render(<BoardEditor onApply={vi.fn()} onClose={vi.fn()} />);

		fireEvent.change(screen.getByLabelText("Side to move"), { target: { value: "black" } });
		fireEvent.click(screen.getByLabelText("White O-O"));
		fireEvent.change(screen.getByLabelText("En passant target square"), {
			target: { value: "e3" },
		});
		fireEvent.change(screen.getByLabelText("Halfmove clock"), { target: { value: "12" } });

		expect(fenValue()).toBe(
			"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b Qkq e3 12 1",
		);
	});

	it("validates an empty board and enables Apply for a legal custom position", () => {
		const onApply = vi.fn();
		render(<BoardEditor onApply={onApply} onClose={vi.fn()} />);

		fireEvent.click(screen.getByText("Clear Board"));
		expect(screen.getByRole("alert")).toHaveTextContent(/king/i);
		expect(screen.getByText("Apply Position")).toBeDisabled();

		place("editor-piece-K", 7, 4);
		place("editor-piece-k", 0, 4);

		expect(screen.getByText("Position is valid")).toBeInTheDocument();
		fireEvent.click(screen.getByText("Apply Position"));
		expect(onApply).toHaveBeenCalledWith("4k3/8/8/8/8/8/8/4K3 w - - 0 1");
	});

	it("rejects pawns on the back ranks", () => {
		render(<BoardEditor onApply={vi.fn()} onClose={vi.fn()} />);

		place("editor-piece-P", 0, 0);

		expect(screen.getByRole("alert")).toHaveTextContent(/edge rows|rank 8/i);
		expect(screen.getByText("Apply Position")).toBeDisabled();
	});

	it("erases pieces with the eraser tool and the context menu", () => {
		render(<BoardEditor onApply={vi.fn()} onClose={vi.fn()} />);

		fireEvent.click(screen.getByLabelText("Eraser"));
		fireEvent.click(screen.getByTestId("editor-square-7-4"));
		expect(fenValue()).toContain("RNBQ1BNR");

		fireEvent.contextMenu(screen.getByTestId("editor-square-0-4"));
		expect(fenValue()).toMatch(/^rnbq1bnr\//);
	});

	it("resets back to the starting position", () => {
		render(<BoardEditor onApply={vi.fn()} onClose={vi.fn()} />);

		fireEvent.click(screen.getByText("Clear Board"));
		fireEvent.click(screen.getByText("Reset"));

		expect(fenValue()).toBe(START_FEN);
	});

	it("closes on Escape and backdrop click", () => {
		const onClose = vi.fn();
		const { rerender } = render(<BoardEditor onApply={vi.fn()} onClose={onClose} />);

		fireEvent.keyDown(window, { key: "Escape" });
		expect(onClose).toHaveBeenCalledTimes(1);

		fireEvent.click(screen.getByRole("presentation"));
		expect(onClose).toHaveBeenCalledTimes(2);

		rerender(<BoardEditor onApply={vi.fn()} onClose={onClose} />);
		expect(screen.getByRole("dialog", { name: "Board Editor" })).toBeInTheDocument();
	});
});
