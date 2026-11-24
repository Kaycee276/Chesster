import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MoveNavigator from "./MoveNavigator";

describe("MoveNavigator Component", () => {
	const defaultProps = {
		currentMoveIndex: 0,
		totalMoves: 10,
		isPlaying: false,
		onMoveChange: vi.fn(),
		onTogglePlay: vi.fn(),
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("Button States and Disabled Attributes", () => {
		it("disables first and previous buttons when at start (currentMoveIndex = -1)", () => {
			render(
				<MoveNavigator
					{...defaultProps}
					currentMoveIndex={-1}
					totalMoves={10}
				/>
			);

			const buttons = screen.getAllByRole("button");
			expect(buttons[0]).toBeDisabled(); // First move button
			expect(buttons[1]).toBeDisabled(); // Previous move button
		});

		it("disables next and last buttons when at end (currentMoveIndex = totalMoves - 1)", () => {
			render(
				<MoveNavigator
					{...defaultProps}
					currentMoveIndex={9}
					totalMoves={10}
				/>
			);

			const buttons = screen.getAllByRole("button");
			expect(buttons[3]).toBeDisabled(); // Next move button
			expect(buttons[4]).toBeDisabled(); // Last move button
		});

		it("enables all navigation buttons in the middle of the game", () => {
			render(
				<MoveNavigator
					{...defaultProps}
					currentMoveIndex={5}
					totalMoves={10}
				/>
			);

			const buttons = screen.getAllByRole("button");
			expect(buttons[0]).not.toBeDisabled(); // First move button
			expect(buttons[1]).not.toBeDisabled(); // Previous move button
			expect(buttons[3]).not.toBeDisabled(); // Next move button
			expect(buttons[4]).not.toBeDisabled(); // Last move button
		});

		it("disables play/pause button when totalMoves is 0", () => {
			render(
				<MoveNavigator
					{...defaultProps}
					totalMoves={0}
					currentMoveIndex={-1}
				/>
			);

			const buttons = screen.getAllByRole("button");
			const playButton = buttons[2];
			expect(playButton).toBeDisabled();
		});
	});

	describe("Button Click Handlers", () => {
		it("calls onMoveChange with -1 when first move button is clicked", async () => {
			const onMoveChange = vi.fn();
			render(
				<MoveNavigator
					{...defaultProps}
					currentMoveIndex={5}
					onMoveChange={onMoveChange}
				/>
			);

			const buttons = screen.getAllByRole("button");
			await userEvent.click(buttons[0]);
			expect(onMoveChange).toHaveBeenCalledWith(-1);
		});

		it("calls onMoveChange with currentMoveIndex - 1 when previous button is clicked", async () => {
			const onMoveChange = vi.fn();
			render(
				<MoveNavigator
					{...defaultProps}
					currentMoveIndex={5}
					onMoveChange={onMoveChange}
				/>
			);

			const buttons = screen.getAllByRole("button");
			await userEvent.click(buttons[1]);
			expect(onMoveChange).toHaveBeenCalledWith(4);
		});

		it("calls onMoveChange with currentMoveIndex + 1 when next button is clicked", async () => {
			const onMoveChange = vi.fn();
			render(
				<MoveNavigator
					{...defaultProps}
					currentMoveIndex={5}
					onMoveChange={onMoveChange}
				/>
			);

			const buttons = screen.getAllByRole("button");
			await userEvent.click(buttons[3]);
			expect(onMoveChange).toHaveBeenCalledWith(6);
		});

		it("calls onMoveChange with totalMoves - 1 when last move button is clicked", async () => {
			const onMoveChange = vi.fn();
			render(
				<MoveNavigator
					{...defaultProps}
					currentMoveIndex={5}
					totalMoves={10}
					onMoveChange={onMoveChange}
				/>
			);

			const buttons = screen.getAllByRole("button");
			await userEvent.click(buttons[4]);
			expect(onMoveChange).toHaveBeenCalledWith(9);
		});

		it("calls onTogglePlay when play/pause button is clicked", async () => {
			const onTogglePlay = vi.fn();
			render(
				<MoveNavigator
					{...defaultProps}
					onTogglePlay={onTogglePlay}
				/>
			);

			const buttons = screen.getAllByRole("button");
			await userEvent.click(buttons[2]);
			expect(onTogglePlay).toHaveBeenCalledOnce();
		});
	});

	describe("Keyboard Navigation", () => {
		it("navigates to previous move on ArrowLeft", () => {
			const onMoveChange = vi.fn();
			render(
				<MoveNavigator
					{...defaultProps}
					currentMoveIndex={5}
					onMoveChange={onMoveChange}
				/>
			);

			fireEvent.keyDown(window, { key: "ArrowLeft" });
			expect(onMoveChange).toHaveBeenCalledWith(4);
		});

		it("navigates to next move on ArrowRight", () => {
			const onMoveChange = vi.fn();
			render(
				<MoveNavigator
					{...defaultProps}
					currentMoveIndex={5}
					onMoveChange={onMoveChange}
				/>
			);

			fireEvent.keyDown(window, { key: "ArrowRight" });
			expect(onMoveChange).toHaveBeenCalledWith(6);
		});

		it("navigates to start position on Home key", () => {
			const onMoveChange = vi.fn();
			render(
				<MoveNavigator
					{...defaultProps}
					currentMoveIndex={5}
					onMoveChange={onMoveChange}
				/>
			);

			fireEvent.keyDown(window, { key: "Home" });
			expect(onMoveChange).toHaveBeenCalledWith(-1);
		});

		it("navigates to end position on End key", () => {
			const onMoveChange = vi.fn();
			render(
				<MoveNavigator
					{...defaultProps}
					currentMoveIndex={5}
					totalMoves={10}
					onMoveChange={onMoveChange}
				/>
			);

			fireEvent.keyDown(window, { key: "End" });
			expect(onMoveChange).toHaveBeenCalledWith(9);
		});

		it("navigates to start on ArrowUp (alternative Home key)", () => {
			const onMoveChange = vi.fn();
			render(
				<MoveNavigator
					{...defaultProps}
					currentMoveIndex={5}
					onMoveChange={onMoveChange}
				/>
			);

			fireEvent.keyDown(window, { key: "ArrowUp" });
			expect(onMoveChange).toHaveBeenCalledWith(-1);
		});

		it("navigates to end on ArrowDown (alternative End key)", () => {
			const onMoveChange = vi.fn();
			render(
				<MoveNavigator
					{...defaultProps}
					currentMoveIndex={5}
					totalMoves={10}
					onMoveChange={onMoveChange}
				/>
			);

			fireEvent.keyDown(window, { key: "ArrowDown" });
			expect(onMoveChange).toHaveBeenCalledWith(9);
		});

		it("does not navigate when at start boundary on ArrowLeft", () => {
			const onMoveChange = vi.fn();
			render(
				<MoveNavigator
					{...defaultProps}
					currentMoveIndex={-1}
					onMoveChange={onMoveChange}
				/>
			);

			fireEvent.keyDown(window, { key: "ArrowLeft" });
			expect(onMoveChange).not.toHaveBeenCalled();
		});

		it("does not navigate when at end boundary on ArrowRight", () => {
			const onMoveChange = vi.fn();
			render(
				<MoveNavigator
					{...defaultProps}
					currentMoveIndex={9}
					totalMoves={10}
					onMoveChange={onMoveChange}
				/>
			);

			fireEvent.keyDown(window, { key: "ArrowRight" });
			expect(onMoveChange).not.toHaveBeenCalled();
		});

		it("suppresses keyboard navigation when typing in an input field", () => {
			const onMoveChange = vi.fn();
			const { container } = render(
				<div>
					<input type="text" placeholder="Type here" />
					<MoveNavigator
						{...defaultProps}
						currentMoveIndex={5}
						onMoveChange={onMoveChange}
					/>
				</div>
			);

			const input = container.querySelector("input");
			if (input) {
				fireEvent.keyDown(input, { key: "ArrowLeft" });
				expect(onMoveChange).not.toHaveBeenCalled();
			}
		});

		it("suppresses keyboard navigation when typing in a textarea", () => {
			const onMoveChange = vi.fn();
			const { container } = render(
				<div>
					<textarea placeholder="Type here" />
					<MoveNavigator
						{...defaultProps}
						currentMoveIndex={5}
						onMoveChange={onMoveChange}
					/>
				</div>
			);

			const textarea = container.querySelector("textarea");
			if (textarea) {
				fireEvent.keyDown(textarea, { key: "ArrowLeft" });
				expect(onMoveChange).not.toHaveBeenCalled();
			}
		});
	});

	describe("Autoplay Toggle", () => {
		it("displays play icon when isPlaying is false", () => {
			render(
				<MoveNavigator
					{...defaultProps}
					isPlaying={false}
				/>
			);

			const buttons = screen.getAllByRole("button");
			const playButton = buttons[2];
			expect(playButton).toHaveAttribute("title", "Play");
			expect(playButton).toHaveAttribute("aria-label", "Play");
		});

		it("displays pause icon when isPlaying is true", () => {
			render(
				<MoveNavigator
					{...defaultProps}
					isPlaying={true}
				/>
			);

			const buttons = screen.getAllByRole("button");
			const pauseButton = buttons[2];
			expect(pauseButton).toHaveAttribute("title", "Pause");
			expect(pauseButton).toHaveAttribute("aria-label", "Pause");
		});
	});

	describe("Move Scrubber Slider", () => {
		it("renders move scrubber slider when totalMoves > 0", () => {
			render(
				<MoveNavigator
					{...defaultProps}
					totalMoves={10}
					currentMoveIndex={5}
				/>
			);

			const slider = screen.getByRole("slider") as HTMLInputElement;
			expect(slider).toBeInTheDocument();
			expect(slider).toHaveAttribute("min", "-1");
			expect(slider).toHaveAttribute("max", "9");
			expect(slider).toHaveValue("5");
		});

		it("does not render slider when totalMoves is 0", () => {
			render(
				<MoveNavigator
					{...defaultProps}
					totalMoves={0}
					currentMoveIndex={-1}
				/>
			);

			const slider = screen.queryByRole("slider");
			expect(slider).not.toBeInTheDocument();
		});

		it("calls onMoveChange when slider is moved", async () => {
			const onMoveChange = vi.fn();
			render(
				<MoveNavigator
					{...defaultProps}
					totalMoves={10}
					currentMoveIndex={5}
					onMoveChange={onMoveChange}
				/>
			);

			const slider = screen.getByRole("slider") as HTMLInputElement;
			fireEvent.change(slider, { target: { value: "7" } });
			expect(onMoveChange).toHaveBeenCalledWith(7);
		});

		it("displays correct move indices in slider labels", () => {
			const { container } = render(
				<MoveNavigator
					{...defaultProps}
					totalMoves={10}
					currentMoveIndex={5}
				/>
			);

			const spans = container.querySelectorAll(".text-\\[10px\\]");
			const moveNumbers = Array.from(spans).map((s) => s.textContent?.trim());
			expect(moveNumbers).toContain("6"); // currentMoveIndex + 1
			expect(moveNumbers).toContain("10"); // totalMoves
		});
	});

	describe("Keyboard Navigation Cleanup", () => {
		it("removes keyboard event listener on unmount", () => {
			const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");
			const { unmount } = render(
				<MoveNavigator
					{...defaultProps}
					currentMoveIndex={5}
				/>
			);

			unmount();
			expect(removeEventListenerSpy).toHaveBeenCalledWith(
				"keydown",
				expect.any(Function)
			);

			removeEventListenerSpy.mockRestore();
		});
	});
});
