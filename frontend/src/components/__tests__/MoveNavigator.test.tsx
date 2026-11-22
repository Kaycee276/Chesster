import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import MoveNavigator from "../MoveNavigator";
import { useToastStore } from "../../store/toastStore";

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

	describe("clipboard copy buttons", () => {
		const sampleFen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
		const samplePgn = "1. e4 e5 2. Nf3 Nc6 *";

		beforeEach(() => {
			useToastStore.setState({ toasts: [] });
		});

		it("renders Copy FEN and Copy PGN buttons with accessible labels and tooltips", () => {
			render(
				<MoveNavigator
					currentMoveIndex={0}
					totalMoves={4}
					isPlaying={false}
					onMoveChange={onMoveChange}
					onTogglePlay={onTogglePlay}
					currentFen={sampleFen}
					pgn={samplePgn}
				/>
			);

			const fenBtn = screen.getByRole("button", { name: /copy fen to clipboard/i });
			const pgnBtn = screen.getByRole("button", { name: /copy pgn to clipboard/i });

			expect(fenBtn).toHaveAttribute("title", "Copy FEN to clipboard");
			expect(pgnBtn).toHaveAttribute("title", "Copy PGN to clipboard");
			expect(fenBtn).toBeEnabled();
			expect(pgnBtn).toBeEnabled();
		});

		it("disables Copy FEN and Copy PGN buttons when values are missing", () => {
			render(
				<MoveNavigator
					currentMoveIndex={-1}
					totalMoves={0}
					isPlaying={false}
					onMoveChange={onMoveChange}
					onTogglePlay={onTogglePlay}
				/>
			);

			expect(screen.getByRole("button", { name: /copy fen to clipboard/i })).toBeDisabled();
			expect(screen.getByRole("button", { name: /copy pgn to clipboard/i })).toBeDisabled();
		});

		it("copies FEN using navigator.clipboard and shows a success toast", async () => {
			const writeText = vi.fn().mockResolvedValue(undefined);
			Object.defineProperty(navigator, "clipboard", {
				value: { writeText },
				configurable: true,
			});

			render(
				<MoveNavigator
					currentMoveIndex={0}
					totalMoves={4}
					isPlaying={false}
					onMoveChange={onMoveChange}
					onTogglePlay={onTogglePlay}
					currentFen={sampleFen}
					pgn={samplePgn}
				/>
			);

			fireEvent.click(screen.getByRole("button", { name: /copy fen to clipboard/i }));

			await waitFor(() => {
				expect(writeText).toHaveBeenCalledWith(sampleFen);
			});

			const toasts = useToastStore.getState().toasts;
			expect(toasts).toHaveLength(1);
			expect(toasts[0]).toMatchObject({
				message: "FEN copied to clipboard!",
				type: "success",
			});
		});

		it("copies PGN using navigator.clipboard and shows a success toast", async () => {
			const writeText = vi.fn().mockResolvedValue(undefined);
			Object.defineProperty(navigator, "clipboard", {
				value: { writeText },
				configurable: true,
			});

			render(
				<MoveNavigator
					currentMoveIndex={0}
					totalMoves={4}
					isPlaying={false}
					onMoveChange={onMoveChange}
					onTogglePlay={onTogglePlay}
					currentFen={sampleFen}
					pgn={samplePgn}
				/>
			);

			fireEvent.click(screen.getByRole("button", { name: /copy pgn to clipboard/i }));

			await waitFor(() => {
				expect(writeText).toHaveBeenCalledWith(samplePgn);
			});

			const toasts = useToastStore.getState().toasts;
			expect(toasts).toHaveLength(1);
			expect(toasts[0]).toMatchObject({
				message: "PGN copied to clipboard!",
				type: "success",
			});
		});

		it("falls back to document.execCommand when navigator.clipboard is unavailable", async () => {
			Object.defineProperty(navigator, "clipboard", {
				value: undefined,
				configurable: true,
			});
			const execCommand = vi.fn().mockReturnValue(true);
			Object.defineProperty(document, "execCommand", {
				value: execCommand,
				configurable: true,
			});

			render(
				<MoveNavigator
					currentMoveIndex={0}
					totalMoves={4}
					isPlaying={false}
					onMoveChange={onMoveChange}
					onTogglePlay={onTogglePlay}
					currentFen={sampleFen}
					pgn={samplePgn}
				/>
			);

			fireEvent.click(screen.getByRole("button", { name: /copy fen to clipboard/i }));

			await waitFor(() => {
				expect(execCommand).toHaveBeenCalledWith("copy");
			});

			const toasts = useToastStore.getState().toasts;
			expect(toasts).toHaveLength(1);
			expect(toasts[0]).toMatchObject({
				message: "FEN copied to clipboard!",
				type: "success",
			});
		});

		it("shows an error toast when both clipboard API and fallback fail", async () => {
			const writeText = vi.fn().mockRejectedValue(new Error("NotAllowedError"));
			Object.defineProperty(navigator, "clipboard", {
				value: { writeText },
				configurable: true,
			});
			const execCommand = vi.fn().mockReturnValue(false);
			Object.defineProperty(document, "execCommand", {
				value: execCommand,
				configurable: true,
			});

			render(
				<MoveNavigator
					currentMoveIndex={0}
					totalMoves={4}
					isPlaying={false}
					onMoveChange={onMoveChange}
					onTogglePlay={onTogglePlay}
					currentFen={sampleFen}
					pgn={samplePgn}
				/>
			);

			fireEvent.click(screen.getByRole("button", { name: /copy pgn to clipboard/i }));

			await waitFor(() => {
				expect(useToastStore.getState().toasts).toHaveLength(1);
			});

			expect(useToastStore.getState().toasts[0]).toMatchObject({
				message: "Failed to copy PGN to clipboard",
				type: "error",
			});
		});
	});
});
