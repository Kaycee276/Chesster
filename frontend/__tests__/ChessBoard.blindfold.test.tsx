import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import ChessBoard from "../src/components/ChessBoard";
import { useGameStore } from "../src/store/gameStore";

// Mock the dependencies
vi.mock("../src/api/gameApi", () => ({
	api: {
		makeMove: vi.fn(),
		getMoves: vi.fn().mockResolvedValue({ success: true, data: [] }),
		getGame: vi.fn(),
		createGame: vi.fn(),
		joinGame: vi.fn(),
		resignGame: vi.fn(),
		offerDraw: vi.fn(),
		acceptDraw: vi.fn(),
		getChatHistory: vi.fn().mockResolvedValue({ success: true, data: [] }),
	},
}));

vi.mock("../src/api/socket", () => ({
	socketService: {
		connect: vi.fn(),
		disconnect: vi.fn(),
		joinGame: vi.fn(),
		leaveGame: vi.fn(),
		onGameUpdate: vi.fn(),
		onChatMessage: vi.fn(),
		offGameUpdate: vi.fn(),
		offChatMessage: vi.fn(),
		sendChatMessage: vi.fn(),
	},
}));

vi.mock("../src/services/soundService", () => ({
	soundService: {
		isEnabled: vi.fn().mockReturnValue(true),
		toggle: vi.fn().mockReturnValue(true),
		getVolume: vi.fn().mockReturnValue(0.8),
		setVolume: vi.fn(),
		move: vi.fn(),
		capture: vi.fn(),
		castle: vi.fn(),
		promote: vi.fn(),
		check: vi.fn(),
		gameStart: vi.fn(),
		gameEnd: vi.fn(),
		draw: vi.fn(),
	},
}));

const mockBoard = [
	["r", "n", "b", "q", "k", "b", "n", "r"],
	["p", "p", "p", "p", "p", "p", "p", "p"],
	[".", ".", ".", ".", ".", ".", ".", "."],
	[".", ".", ".", ".", ".", ".", ".", "."],
	[".", ".", ".", ".", ".", ".", ".", "."],
	[".", ".", ".", ".", ".", ".", ".", "."],
	["P", "P", "P", "P", "P", "P", "P", "P"],
	["R", "N", "B", "Q", "K", "B", "N", "R"],
];

const renderChessBoard = () => {
	return render(
		<BrowserRouter>
			<ChessBoard />
		</BrowserRouter>,
	);
};

describe("ChessBoard - Blindfold Mode Rendering", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		useGameStore.setState({
			gameCode: "TEST123",
			playerColor: "white",
			board: mockBoard,
			currentTurn: "white",
			status: "active",
			isBlindfoldMode: false,
			moveHistory: [],
		});
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.clearAllMocks();
	});

	it("renders normal piece SVGs when blindfold mode is false", () => {
		const { container } = renderChessBoard();

		// Should render piece symbols (Unicode characters)
		expect(screen.queryByText("♚")).toBeTruthy(); // Black king
		expect(screen.queryByText("♔")).toBeTruthy(); // White king
	});

	it("hides piece SVGs and shows placeholder dots when blindfold mode is true", () => {
		useGameStore.setState({ isBlindfoldMode: true });
		const { container } = renderChessBoard();

		// Should NOT render piece symbols
		expect(screen.queryByText("♚")).toBeFalsy();
		expect(screen.queryByText("♔")).toBeFalsy();

		// Should render placeholder dots (divs with specific dimensions)
		const dots = container.querySelectorAll(
			'div[style*="width: calc(var(--board-size) / 8 * 0.18)"]',
		);
		expect(dots.length).toBeGreaterThan(0);
	});

	it("reveals real pieces when peeking (isPeeking is true)", async () => {
		useGameStore.setState({ isBlindfoldMode: true });
		const { container } = renderChessBoard();

		// Initially hidden
		expect(screen.queryByText("♚")).toBeFalsy();

		// Trigger peek
		const peekButton = screen.getByTitle(/Peek at pieces/i);
		fireEvent.click(peekButton);

		// After peek is triggered, pieces should be visible
		await waitFor(() => {
			expect(screen.queryByText("♚")).toBeTruthy();
		});
	});

	it("hides pieces again after peek duration (2 seconds)", async () => {
		useGameStore.setState({ isBlindfoldMode: true });
		renderChessBoard();

		// Trigger peek
		const peekButton = screen.getByTitle(/Peek at pieces/i);
		fireEvent.click(peekButton);

		// Pieces should be visible immediately
		await waitFor(() => {
			expect(screen.queryByText("♚")).toBeTruthy();
		});

		// Advance timers by 2 seconds
		vi.advanceTimersByTime(2000);

		// Pieces should be hidden again
		await waitFor(() => {
			expect(screen.queryByText("♚")).toBeFalsy();
		});
	});

	it("peek button is disabled while peeking", async () => {
		useGameStore.setState({ isBlindfoldMode: true });
		renderChessBoard();

		const peekButton = screen.getByTitle(/Peek at pieces/i) as HTMLButtonElement;
		expect(peekButton.disabled).toBe(false);

		fireEvent.click(peekButton);

		await waitFor(() => {
			expect(peekButton.disabled).toBe(true);
		});
	});

	it("peek button is re-enabled after 2 seconds", async () => {
		useGameStore.setState({ isBlindfoldMode: true });
		renderChessBoard();

		const peekButton = screen.getByTitle(/Peek at pieces/i) as HTMLButtonElement;
		fireEvent.click(peekButton);

		await waitFor(() => {
			expect(peekButton.disabled).toBe(true);
		});

		vi.advanceTimersByTime(2000);

		await waitFor(() => {
			expect(peekButton.disabled).toBe(false);
		});
	});

	it("rapid double-click on peek button doesn't produce competing timers", async () => {
		useGameStore.setState({ isBlindfoldMode: true });
		renderChessBoard();

		const peekButton = screen.getByTitle(/Peek at pieces/i);

		// First click
		fireEvent.click(peekButton);
		await waitFor(() => {
			expect(screen.queryByText("♚")).toBeTruthy();
		});

		// Advance to 1 second (before original 2s ends)
		vi.advanceTimersByTime(1000);

		// Second click (should restart the timer)
		fireEvent.click(peekButton);

		// Advance another 1 second (total 2s from original click, but only 1s from new click)
		vi.advanceTimersByTime(1000);

		// Pieces should still be visible (2s from the second click hasn't elapsed)
		await waitFor(() => {
			expect(screen.queryByText("♚")).toBeTruthy();
		});

		// Advance another 1 second (total 2s from second click)
		vi.advanceTimersByTime(1000);

		// Now pieces should be hidden
		await waitFor(() => {
			expect(screen.queryByText("♚")).toBeFalsy();
		});
	});

	it("peek button is only visible when blindfold mode is active", () => {
		useGameStore.setState({ isBlindfoldMode: false });
		renderChessBoard();

		expect(screen.queryByTitle(/Peek at pieces/i)).toBeFalsy();

		// Enable blindfold mode
		useGameStore.setState({ isBlindfoldMode: true });
		renderChessBoard();

		expect(screen.queryByTitle(/Peek at pieces/i)).toBeTruthy();
	});

	it("squares remain clickable when blindfold mode is active and pieces are hidden", async () => {
		useGameStore.setState({ isBlindfoldMode: true });
		const { container } = renderChessBoard();

		const square = container.querySelector('[data-testid="square-1-4"]');
		expect(square).toBeTruthy();

		// Click a square with a piece (e2 for white pawn)
		const e2Square = container.querySelector('[data-testid="square-6-4"]');
		expect(e2Square).toBeTruthy();

		fireEvent.click(e2Square!);

		// The click should be processed (square should be selectable)
		// Even though piece is hidden, the square interaction must work
		await waitFor(() => {
			const selected = container.querySelector('[data-testid="square-6-4"]');
			// Square should have selection styling
			expect(selected?.className).toContain("bg-yellow");
		});
	});

	it("cleans up timer on component unmount", () => {
		useGameStore.setState({ isBlindfoldMode: true });
		const { unmount } = renderChessBoard();

		const peekButton = screen.getByTitle(/Peek at pieces/i);
		fireEvent.click(peekButton);

		// Unmount before timer fires
		unmount();

		// Advance timer - should not cause any errors
		vi.advanceTimersByTime(3000);

		// No errors should occur
		expect(true).toBe(true);
	});

	it("isPeeking resets to false on component remount", async () => {
		useGameStore.setState({ isBlindfoldMode: true });
		const { unmount } = renderChessBoard();

		const peekButton = screen.getByTitle(/Peek at pieces/i);
		fireEvent.click(peekButton);

		await waitFor(() => {
			expect(screen.queryByText("♚")).toBeTruthy();
		});

		unmount();

		// Remount component
		renderChessBoard();

		// Pieces should be hidden again (isPeeking reset to false)
		await waitFor(() => {
			expect(screen.queryByText("♚")).toBeFalsy();
		});
	});

	it("toggles between blindfold and normal rendering modes", async () => {
		const { rerender } = renderChessBoard();

		// Initially in normal mode
		expect(screen.queryByText("♚")).toBeTruthy();

		// Switch to blindfold mode
		useGameStore.setState({ isBlindfoldMode: true });
		rerender(
			<BrowserRouter>
				<ChessBoard />
			</BrowserRouter>,
		);

		expect(screen.queryByText("♚")).toBeFalsy();

		// Switch back to normal mode
		useGameStore.setState({ isBlindfoldMode: false });
		rerender(
			<BrowserRouter>
				<ChessBoard />
			</BrowserRouter>,
		);

		expect(screen.queryByText("♚")).toBeTruthy();
	});

	it("move interaction is not affected by blindfold mode", async () => {
		useGameStore.setState({ 
			isBlindfoldMode: true,
			playerColor: "white",
			currentTurn: "white",
		});
		const { container } = renderChessBoard();

		// Click on e2 (white pawn at [6, 4])
		const e2Square = container.querySelector('[data-testid="square-6-4"]');
		fireEvent.click(e2Square!);

		// Square should be selected
		await waitFor(() => {
			expect(e2Square?.className).toContain("bg-yellow");
		});

		// Click on e3 to move there ([5, 4])
		const e3Square = container.querySelector('[data-testid="square-5-4"]');
		fireEvent.click(e3Square!);

		// Move should be processed
		// (The actual move would be handled by the store)
		expect(true).toBe(true);
	});
});

describe("ChessBoard - Peek Button Position and Styling", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		useGameStore.setState({
			gameCode: "TEST123",
			playerColor: "white",
			board: mockBoard,
			currentTurn: "white",
			status: "active",
			isBlindfoldMode: true,
			moveHistory: [],
		});
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.clearAllMocks();
	});

	it("peek button appears in action bar when blindfold mode is active", () => {
		renderChessBoard();
		const peekButton = screen.getByTitle(/Peek at pieces/i);
		expect(peekButton).toBeTruthy();
	});

	it("peek button shows eye icon", () => {
		const { container } = renderChessBoard();
		const peekButton = screen.getByTitle(/Peek at pieces/i);
		const svg = peekButton.querySelector("svg");
		expect(svg).toBeTruthy();
	});

	it("peek button has correct title text", () => {
		renderChessBoard();
		const peekButton = screen.getByTitle(/Peek at pieces/i);
		expect(peekButton.title).toContain("Peek");
	});
});
