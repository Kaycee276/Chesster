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
});
