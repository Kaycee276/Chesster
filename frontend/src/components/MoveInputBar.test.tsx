import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import MoveInputBar from "./MoveInputBar";
import { INITIAL_BOARD } from "../utils/chessUtils";

afterEach(cleanup);

const board = () => INITIAL_BOARD.map((row) => [...row]);

function setup(overrides: Partial<Parameters<typeof MoveInputBar>[0]> = {}) {
	const onMove = vi.fn();
	const focusRef = createRef<HTMLInputElement | null>();
	render(
		<MoveInputBar
			board={board()}
			turn="white"
			isPlayerTurn
			onMove={onMove}
			focusRef={focusRef}
			{...overrides}
		/>,
	);
	return { onMove, focusRef };
}

describe("MoveInputBar", () => {
	let user: ReturnType<typeof userEvent.setup>;

	beforeEach(() => {
		user = userEvent.setup();
	});

	it("submits a legal typed move through onMove", async () => {
		const { onMove } = setup();

		const input = screen.getByLabelText(/quick move input/i);
		await user.type(input, "e4");
		await user.keyboard("{Enter}");

		expect(onMove).toHaveBeenCalledOnce();
		expect(onMove).toHaveBeenCalledWith([6, 4], [4, 4], undefined);
	});

	it("announces and keeps the text when the move is invalid", async () => {
		const { onMove } = setup();

		const input = screen.getByLabelText(/quick move input/i);
		await user.type(input, "zz9");
		await user.keyboard("{Enter}");

		expect(onMove).not.toHaveBeenCalled();
		expect(screen.getByRole("status")).toHaveTextContent(/invalid move/i);
		// The text stays so the user can correct it.
		expect(input).toHaveValue("zz9");
	});

	it("clears the field after a successful move", async () => {
		setup();

		const input = screen.getByLabelText(/quick move input/i);
		await user.type(input, "Nf3");
		await user.keyboard("{Enter}");

		expect(input).toHaveValue("");
	});

	it("disables input when it is not the player's turn", () => {
		setup({ isPlayerTurn: false });

		expect(screen.getByLabelText(/quick move input/i)).toBeDisabled();
		expect(screen.getByRole("button", { name: /play typed move/i })).toBeDisabled();
	});

	it("is focusable through the provided ref for the global shortcut", async () => {
		const { focusRef } = setup();

		focusRef.current?.focus();
		await user.keyboard("e4{Enter}");

		expect(screen.getByLabelText(/quick move input/i)).toHaveValue("");
	});
});
