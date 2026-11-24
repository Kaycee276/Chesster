import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import EvaluationGraph from "../EvaluationGraph";

describe("EvaluationGraph", () => {
	it("plots white and black advantage and lets a point seek its move", () => {
		const onMoveChange = vi.fn();
		render(
			<EvaluationGraph
				evaluations={[0, 250, -100, 50]}
				currentMoveIndex={-1}
				onMoveChange={onMoveChange}
			/>,
		);

		expect(screen.getByTestId("white-advantage-area").getAttribute("d")).not.toBe("");
		expect(screen.getByTestId("black-advantage-area").getAttribute("d")).not.toBe("");

		fireEvent.click(screen.getByRole("button", { name: "Move 1 after White: +2.5" }));

		expect(onMoveChange).toHaveBeenCalledWith(0);
	});

	it("supports keyboard seeking and identifies the starting position", () => {
		const onMoveChange = vi.fn();
		render(
			<EvaluationGraph
				evaluations={[0, 100]}
				currentMoveIndex={-1}
				onMoveChange={onMoveChange}
			/>,
		);

		fireEvent.keyDown(screen.getByRole("button", { name: "Starting position: 0.0" }), {
			key: "Enter",
		});

		expect(onMoveChange).toHaveBeenCalledWith(-1);
	});

	it.each([
		[49, null], [50, "inaccuracy"], [99, "inaccuracy"],
		[100, "mistake"], [300, "mistake"], [301, "blunder"],
	])("classifies a %icp loss as %s", (loss, classification) => {
		const { container } = render(<EvaluationGraph evaluations={[0, -loss]} currentMoveIndex={-1} onMoveChange={vi.fn()} />);
		const marker = container.querySelector("[data-classification]");
		if (classification) {
			expect(marker).toHaveAttribute("data-classification", classification);
			expect(marker?.querySelector("circle[fill]:last-of-type")).toBeInTheDocument();
		} else expect(marker).toBeNull();
	});

	it("marks losses for each player, uses raw scores and never marks improvements", () => {
		const { container } = render(<EvaluationGraph evaluations={[700, 280, 430, 800, 600]} currentMoveIndex={-1} onMoveChange={vi.fn()} />);
		const markers = container.querySelectorAll("[data-classification]");
		expect(markers).toHaveLength(2);
		expect(markers[0]).toHaveAttribute("data-classification", "blunder");
		expect(markers[1]).toHaveAttribute("data-classification", "mistake");
		expect(markers[0].querySelector("text")).toHaveTextContent("??");
		expect(markers[1].querySelector("text")).toHaveTextContent("?");
	});

	it("does not infer losses across missing or nonfinite evaluations", () => {
		const { container } = render(<EvaluationGraph evaluations={[0, null, -500, NaN, 500, Infinity, -500]} currentMoveIndex={-1} onMoveChange={vi.fn()} />);
		expect(container.querySelector("[data-classification]")).toBeNull();
	});

	it("shows notation and loss on hover or focus and seeks the exact move", () => {
		const onMoveChange = vi.fn();
		render(<EvaluationGraph evaluations={[0, -75, 345]} currentMoveIndex={-1} onMoveChange={onMoveChange} moves={[
			{ san: "e4", color: "white", moveNumber: 24 },
			{ san: "Qe4", color: "black", moveNumber: 24 },
		]} />);
		const white = screen.getByRole("button", { name: "24. e4?! · Inaccuracy (-0.75 pawns)" });
		const black = screen.getByRole("button", { name: "24... Qe4?? · Blunder (-4.20 pawns)" });
		expect(black.querySelector("title")).toHaveTextContent("24... Qe4?? · Blunder (-4.20 pawns)");
		fireEvent.pointerEnter(black);
		expect(screen.getByText("24... Qe4?? · Blunder (-4.20 pawns)", { selector: "span" })).toBeInTheDocument();
		fireEvent.click(black);
		expect(onMoveChange).toHaveBeenLastCalledWith(1);
		fireEvent.keyDown(white, { key: "Enter" });
		expect(onMoveChange).toHaveBeenLastCalledWith(0);
		fireEvent.keyDown(black, { key: " " });
		expect(onMoveChange).toHaveBeenLastCalledWith(1);
		fireEvent.keyDown(black, { key: "Escape" });
		expect(onMoveChange).toHaveBeenCalledTimes(3);
	});

	it("shows loading state until evaluations are available", () => {
		render(<EvaluationGraph evaluations={[null, null]} currentMoveIndex={-1} onMoveChange={vi.fn()} />);
		expect(screen.getByRole("status")).toHaveTextContent("Evaluation graph is loading.");
	});
});
