import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import MoveNavigator from "../MoveNavigator";

describe("MoveNavigator", () => {
	const onMoveChange = vi.fn();
	const onTogglePlay = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("renders navigation buttons with keyboard shortcut tooltips and aria-labels", () => {
		render(
			<MoveNavigator
				currentMoveIndex={2}
				totalMoves={10}
				isPlaying={false}
				onMoveChange={onMoveChange}
				onTogglePlay={onTogglePlay}
			/>
		);

		const firstBtn = screen.getByRole("button", { name: /first move/i });
		const prevBtn = screen.getByRole("button", { name: /previous move/i });
		const nextBtn = screen.getByRole("button", { name: /next move/i });
		const lastBtn = screen.getByRole("button", { name: /last move/i });

		expect(firstBtn).toHaveAttribute("title", "First move (Home / Up Arrow)");
		expect(prevBtn).toHaveAttribute("title", "Previous move (Left Arrow)");
		expect(nextBtn).toHaveAttribute("title", "Next move (Right Arrow)");
		expect(lastBtn).toHaveAttribute("title", "Last move (End / Down Arrow)");
	});

	it("navigates backward on ArrowLeft key press", () => {
		render(
			<MoveNavigator
				currentMoveIndex={5}
				totalMoves={10}
				isPlaying={false}
				onMoveChange={onMoveChange}
				onTogglePlay={onTogglePlay}
			/>
		);

		fireEvent.keyDown(window, { key: "ArrowLeft" });
		expect(onMoveChange).toHaveBeenCalledTimes(1);
		expect(onMoveChange).toHaveBeenCalledWith(4);
	});

	it("navigates forward on ArrowRight key press", () => {
		render(
			<MoveNavigator
				currentMoveIndex={5}
				totalMoves={10}
				isPlaying={false}
				onMoveChange={onMoveChange}
				onTogglePlay={onTogglePlay}
			/>
		);

		fireEvent.keyDown(window, { key: "ArrowRight" });
		expect(onMoveChange).toHaveBeenCalledTimes(1);
		expect(onMoveChange).toHaveBeenCalledWith(6);
	});

	it("jumps to starting position on Home and ArrowUp key press", () => {
		const { rerender } = render(
			<MoveNavigator
				currentMoveIndex={5}
				totalMoves={10}
				isPlaying={false}
				onMoveChange={onMoveChange}
				onTogglePlay={onTogglePlay}
			/>
		);

		fireEvent.keyDown(window, { key: "Home" });
		expect(onMoveChange).toHaveBeenCalledWith(-1);

		rerender(
			<MoveNavigator
				currentMoveIndex={5}
				totalMoves={10}
				isPlaying={false}
				onMoveChange={onMoveChange}
				onTogglePlay={onTogglePlay}
			/>
		);

		fireEvent.keyDown(window, { key: "ArrowUp" });
		expect(onMoveChange).toHaveBeenCalledWith(-1);
	});

	it("jumps to last move on End and ArrowDown key press", () => {
		const { rerender } = render(
			<MoveNavigator
				currentMoveIndex={2}
				totalMoves={10}
				isPlaying={false}
				onMoveChange={onMoveChange}
				onTogglePlay={onTogglePlay}
			/>
		);

		fireEvent.keyDown(window, { key: "End" });
		expect(onMoveChange).toHaveBeenCalledWith(9);

		rerender(
			<MoveNavigator
				currentMoveIndex={2}
				totalMoves={10}
				isPlaying={false}
				onMoveChange={onMoveChange}
				onTogglePlay={onTogglePlay}
			/>
		);

		fireEvent.keyDown(window, { key: "ArrowDown" });
		expect(onMoveChange).toHaveBeenCalledWith(9);
	});

	it("does not navigate past the start (-1) on ArrowLeft", () => {
		render(
			<MoveNavigator
				currentMoveIndex={-1}
				totalMoves={10}
				isPlaying={false}
				onMoveChange={onMoveChange}
				onTogglePlay={onTogglePlay}
			/>
		);

		fireEvent.keyDown(window, { key: "ArrowLeft" });
		expect(onMoveChange).not.toHaveBeenCalled();
	});

	it("does not navigate past the end on ArrowRight", () => {
		render(
			<MoveNavigator
				currentMoveIndex={9}
				totalMoves={10}
				isPlaying={false}
				onMoveChange={onMoveChange}
				onTogglePlay={onTogglePlay}
			/>
		);

		fireEvent.keyDown(window, { key: "ArrowRight" });
		expect(onMoveChange).not.toHaveBeenCalled();
	});

	it("completely suppresses shortcuts when user is typing in an INPUT element", () => {
		render(
			<div>
				<input data-testid="chat-input" placeholder="Send a message..." />
				<MoveNavigator
					currentMoveIndex={4}
					totalMoves={10}
					isPlaying={false}
					onMoveChange={onMoveChange}
					onTogglePlay={onTogglePlay}
				/>
			</div>
		);

		const input = screen.getByTestId("chat-input");
		input.focus();

		fireEvent.keyDown(input, { key: "ArrowLeft" });
		fireEvent.keyDown(input, { key: "ArrowRight" });
		fireEvent.keyDown(input, { key: "Home" });
		fireEvent.keyDown(input, { key: "End" });
		fireEvent.keyDown(input, { key: "ArrowUp" });
		fireEvent.keyDown(input, { key: "ArrowDown" });

		expect(onMoveChange).not.toHaveBeenCalled();
	});

	it("completely suppresses shortcuts when user is typing in a TEXTAREA element", () => {
		render(
			<div>
				<textarea data-testid="notes-textarea" />
				<MoveNavigator
					currentMoveIndex={4}
					totalMoves={10}
					isPlaying={false}
					onMoveChange={onMoveChange}
					onTogglePlay={onTogglePlay}
				/>
			</div>
		);

		const textarea = screen.getByTestId("notes-textarea");
		textarea.focus();

		fireEvent.keyDown(textarea, { key: "ArrowLeft" });
		fireEvent.keyDown(textarea, { key: "ArrowRight" });
		fireEvent.keyDown(textarea, { key: "Home" });
		fireEvent.keyDown(textarea, { key: "End" });

		expect(onMoveChange).not.toHaveBeenCalled();
	});

	it("completely suppresses shortcuts when user is typing in a contentEditable element", () => {
		render(
			<div>
				<div data-testid="editable-div" contentEditable="true" />
				<MoveNavigator
					currentMoveIndex={4}
					totalMoves={10}
					isPlaying={false}
					onMoveChange={onMoveChange}
					onTogglePlay={onTogglePlay}
				/>
			</div>
		);

		const editable = screen.getByTestId("editable-div");
		editable.focus();

		fireEvent.keyDown(editable, { key: "ArrowLeft" });
		fireEvent.keyDown(editable, { key: "ArrowRight" });
		fireEvent.keyDown(editable, { key: "Home" });
		fireEvent.keyDown(editable, { key: "End" });

		expect(onMoveChange).not.toHaveBeenCalled();
	});

	it("cleans up keydown listener on unmount", () => {
		const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");
		const { unmount } = render(
			<MoveNavigator
				currentMoveIndex={3}
				totalMoves={10}
				isPlaying={false}
				onMoveChange={onMoveChange}
				onTogglePlay={onTogglePlay}
			/>
		);

		unmount();
		expect(removeEventListenerSpy).toHaveBeenCalledWith("keydown", expect.any(Function));
	});

	it("handles rapid successive keyboard navigations", () => {
		render(
			<MoveNavigator
				currentMoveIndex={5}
				totalMoves={10}
				isPlaying={false}
				onMoveChange={onMoveChange}
				onTogglePlay={onTogglePlay}
			/>
		);

		fireEvent.keyDown(window, { key: "ArrowRight" });
		fireEvent.keyDown(window, { key: "ArrowRight" });
		fireEvent.keyDown(window, { key: "ArrowLeft" });
		fireEvent.keyDown(window, { key: "ArrowLeft" });

		expect(onMoveChange).toHaveBeenCalledTimes(4);
	});

	it("seeks to arbitrary ply via slider input", () => {
		render(
			<MoveNavigator
				currentMoveIndex={3}
				totalMoves={10}
				isPlaying={false}
				onMoveChange={onMoveChange}
				onTogglePlay={onTogglePlay}
			/>
		);

		const slider = screen.getByRole("slider");
		fireEvent.change(slider, { target: { value: "7" } });

		expect(onMoveChange).toHaveBeenCalledWith(7);
	});

	it("seeks from starting position (-1) to first move via slider", () => {
		render(
			<MoveNavigator
				currentMoveIndex={-1}
				totalMoves={10}
				isPlaying={false}
				onMoveChange={onMoveChange}
				onTogglePlay={onTogglePlay}
			/>
		);

		const slider = screen.getByRole("slider");
		fireEvent.change(slider, { target: { value: "0" } });

		expect(onMoveChange).toHaveBeenCalledWith(0);
	});

	it("displays correct move count in the counter element", () => {
		const { rerender } = render(
			<MoveNavigator
				currentMoveIndex={5}
				totalMoves={10}
				isPlaying={false}
				onMoveChange={onMoveChange}
				onTogglePlay={onTogglePlay}
			/>
		);

		expect(screen.getByText("6")).toBeInTheDocument();

		rerender(
			<MoveNavigator
				currentMoveIndex={9}
				totalMoves={10}
				isPlaying={false}
				onMoveChange={onMoveChange}
				onTogglePlay={onTogglePlay}
			/>
		);

		expect(screen.getByText("10")).toBeInTheDocument();
	});

	it("disables all navigation buttons when totalMoves is 0", () => {
		render(
			<MoveNavigator
				currentMoveIndex={-1}
				totalMoves={0}
				isPlaying={false}
				onMoveChange={onMoveChange}
				onTogglePlay={onTogglePlay}
			/>
		);

		const buttons = screen.getAllByRole("button");
		buttons.forEach((btn) => {
			expect(btn).toBeDisabled();
		});
	});

	it("hides slider when totalMoves is 0", () => {
		render(
			<MoveNavigator
				currentMoveIndex={-1}
				totalMoves={0}
				isPlaying={false}
				onMoveChange={onMoveChange}
				onTogglePlay={onTogglePlay}
			/>
		);

		const slider = screen.queryByRole("slider");
		expect(slider).not.toBeInTheDocument();
	});

	it("plays autoplay timer on play toggle", () => {
		vi.useFakeTimers();
		render(
			<MoveNavigator
				currentMoveIndex={3}
				totalMoves={10}
				isPlaying={true}
				onMoveChange={onMoveChange}
				onTogglePlay={onTogglePlay}
			/>
		);

		vi.advanceTimersByTime(800);
		expect(onMoveChange).toHaveBeenCalledWith(4);

		vi.useRealTimers();
	});

	it("stops autoplay at the end and calls onTogglePlay to pause", () => {
		vi.useFakeTimers();
		const { rerender } = render(
			<MoveNavigator
				currentMoveIndex={9}
				totalMoves={10}
				isPlaying={true}
				onMoveChange={onMoveChange}
				onTogglePlay={onTogglePlay}
			/>
		);

		vi.advanceTimersByTime(800);
		expect(onTogglePlay).toHaveBeenCalled();

		vi.useRealTimers();
	});

	it("ignores keyboard shortcuts during active editing in nested contentEditable", () => {
		render(
			<div>
				<div data-testid="outer">
					<div data-testid="nested" contentEditable="true" />
					<MoveNavigator
						currentMoveIndex={4}
						totalMoves={10}
						isPlaying={false}
						onMoveChange={onMoveChange}
						onTogglePlay={onTogglePlay}
					/>
				</div>
			</div>
		);

		const nestedEditable = screen.getByTestId("nested");
		nestedEditable.focus();

		fireEvent.keyDown(nestedEditable, { key: "ArrowLeft" });
		fireEvent.keyDown(nestedEditable, { key: "ArrowRight" });

		expect(onMoveChange).not.toHaveBeenCalled();
	});

	it("seeks to first move via Home key from middle position", () => {
		render(
			<MoveNavigator
				currentMoveIndex={5}
				totalMoves={10}
				isPlaying={false}
				onMoveChange={onMoveChange}
				onTogglePlay={onTogglePlay}
			/>
		);

		fireEvent.keyDown(window, { key: "Home" });
		expect(onMoveChange).toHaveBeenCalledWith(-1);
	});

	it("seeks to last move via End key from middle position", () => {
		render(
			<MoveNavigator
				currentMoveIndex={5}
				totalMoves={10}
				isPlaying={false}
				onMoveChange={onMoveChange}
				onTogglePlay={onTogglePlay}
			/>
		);

		fireEvent.keyDown(window, { key: "End" });
		expect(onMoveChange).toHaveBeenCalledWith(9);
	});

	it("supports both ArrowUp and Home key to seek to start", () => {
		const { rerender } = render(
			<MoveNavigator
				currentMoveIndex={5}
				totalMoves={10}
				isPlaying={false}
				onMoveChange={onMoveChange}
				onTogglePlay={onTogglePlay}
			/>
		);

		fireEvent.keyDown(window, { key: "ArrowUp" });
		expect(onMoveChange).toHaveBeenCalledWith(-1);

		vi.clearAllMocks();

		rerender(
			<MoveNavigator
				currentMoveIndex={5}
				totalMoves={10}
				isPlaying={false}
				onMoveChange={onMoveChange}
				onTogglePlay={onTogglePlay}
			/>
		);

		fireEvent.keyDown(window, { key: "Home" });
		expect(onMoveChange).toHaveBeenCalledWith(-1);
	});

	it("supports both ArrowDown and End key to seek to end", () => {
		const { rerender } = render(
			<MoveNavigator
				currentMoveIndex={5}
				totalMoves={10}
				isPlaying={false}
				onMoveChange={onMoveChange}
				onTogglePlay={onTogglePlay}
			/>
		);

		fireEvent.keyDown(window, { key: "ArrowDown" });
		expect(onMoveChange).toHaveBeenCalledWith(9);

		vi.clearAllMocks();

		rerender(
			<MoveNavigator
				currentMoveIndex={5}
				totalMoves={10}
				isPlaying={false}
				onMoveChange={onMoveChange}
				onTogglePlay={onTogglePlay}
			/>
		);

		fireEvent.keyDown(window, { key: "End" });
		expect(onMoveChange).toHaveBeenCalledWith(9);
	});

	it("prevents default browser behavior for navigation keys", () => {
		render(
			<MoveNavigator
				currentMoveIndex={5}
				totalMoves={10}
				isPlaying={false}
				onMoveChange={onMoveChange}
				onTogglePlay={onTogglePlay}
			/>
		);

		const event = new KeyboardEvent("keydown", { key: "ArrowLeft" });
		const preventDefaultSpy = vi.spyOn(event, "preventDefault");
		fireEvent(window, event);

		expect(preventDefaultSpy).toHaveBeenCalled();
	});

	it("renders slider with correct range attributes", () => {
		render(
			<MoveNavigator
				currentMoveIndex={5}
				totalMoves={10}
				isPlaying={false}
				onMoveChange={onMoveChange}
				onTogglePlay={onTogglePlay}
			/>
		);

		const slider = screen.getByRole("slider") as HTMLInputElement;
		expect(slider).toHaveAttribute("min", "-1");
		expect(slider).toHaveAttribute("max", "9");
		expect(slider.value).toBe("5");
	});

	it("handles single move scenario", () => {
		render(
			<MoveNavigator
				currentMoveIndex={-1}
				totalMoves={1}
				isPlaying={false}
				onMoveChange={onMoveChange}
				onTogglePlay={onTogglePlay}
			/>
		);

		fireEvent.keyDown(window, { key: "ArrowRight" });
		expect(onMoveChange).toHaveBeenCalledWith(0);

		fireEvent.keyDown(window, { key: "ArrowRight" });
		expect(onMoveChange).toHaveBeenCalledTimes(1);
	});
});
