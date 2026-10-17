import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import BroadcastChessBoard from "../BroadcastChessBoard";

const board = [
	["r", "n", "b", "q", "k", "b", "n", "r"],
	...[0, 1, 2, 3, 4].map(() => Array(8).fill(".")),
	["P", "P", "P", "P", "P", "P", "P", "P"],
	["R", "N", "B", "Q", "K", "B", "N", "R"],
];

describe("BroadcastChessBoard", () => {
	it("renders a themed accessible board and flips it to the selected side", () => {
		const { rerender } = render(<BroadcastChessBoard board={board} orientation="white" theme="wood" />);
		expect(screen.getByRole("grid", { name: "Chess board, viewed from white's side" })).toBeInTheDocument();
		expect(screen.getAllByRole("gridcell")).toHaveLength(64);
		expect(screen.getAllByRole("gridcell")[0]).toHaveAccessibleName("Black r");

		rerender(<BroadcastChessBoard board={board} orientation="black" theme="glass" />);
		expect(screen.getAllByRole("gridcell")[0]).toHaveAccessibleName("White r");
	});

	it("shows a safe placeholder when the board payload is incomplete", () => {
		render(<BroadcastChessBoard board={[]} orientation="white" theme="neon" />);
		expect(screen.getByRole("status", { name: "Waiting for the board position" })).toBeInTheDocument();
	});
});
