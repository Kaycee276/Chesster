import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import ChessBoard from "../src/components/ChessBoard";
import { useGameStore } from "../src/store/gameStore";

// Mock the dependencies
vi.mock("../src/api/gameApi", () => ({
	api: {
		makeMove: vi.fn().mockResolvedValue({
			success: true,
			data: {
				board_state: [
					["r", "n", "b", "q", "k", "b", "n", "r"],
					["p", "p", "p", "p", "p", "p", "p", "p"],
					[".", ".", ".", ".", ".", ".", ".", "."],
					[".", ".", ".", ".", ".", ".", ".", "."],
					[".", ".", ".", "P", ".", ".", ".", "."],
					[".", ".", ".", ".", ".", ".", ".", "."],
					["P", "P", "P", ".", "P", "P", "P", "P"],
					["R", "N", "B", "Q", "K", "B", "N", "R"],
				],
				current_turn: "black",
				status: "active",
				in_check: false,
				winner: null,
				end_reason: null,
				draw_offer: null,
				captured_white: [],
				captured_black: [],
				last_move: { from: [6, 4], to: [4, 4], piece: "P" },
			},
		}),
		getMoves: vi.fn().mockResolvedValue({ success: true, data: [] }),
		getGame: vi.fn().mockResolvedValue({
			success: true,
			data: {
				status: "active",
				time_control_seconds: 600,
				board_state: [
					["r", "n", "b", "q", "k", "b", "n", "r"],
					["p", "p", "p", "p", "p", "p", "p", "p"],
					[".", ".", ".", ".", ".", ".", ".", "."],
					[".", ".", ".", ".", ".", ".", ".", "."],
					[".", ".", ".", ".", ".", ".", ".", "."],
					[".", ".", ".", ".", ".", ".", ".", "."],
					["P", "P", "P", "P", "P", "P", "P", "P"],
					["R", "N", "B", "Q", "K", "B", "N", "R"],
				],
				current_turn: "white",
			},
		}),
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
		onRematchRequested: vi.fn(),
		offRematchRequested: vi.fn(),
		requestRematch: vi.fn(),
		onOpponentReconnecting: vi.fn(),
		offOpponentReconnecting: vi.fn(),
		onOpponentReconnected: vi.fn(),
		offOpponentReconnected: vi.fn(),
		sendReaction: vi.fn(),
		onReaction: vi.fn(),
		offReaction: vi.fn(),
		onTournamentMatchCompleted: vi.fn(),
		offTournamentMatchCompleted: vi.fn(),
		onTournamentMatchReady: vi.fn(),
		offTournamentMatchReady: vi.fn(),
	},
}));

vi.mock("../src/services/soundService", () => ({
	soundService: {
		isEnabled: vi.fn().mockReturnValue(true),
		toggle: vi.fn().mockReturnValue(true),
		getVolume: vi.fn().mockReturnValue(0.8),
		setVolume: vi.fn(),
		setMasterVolume: vi.fn(),
		move: vi.fn(),
		capture: vi.fn(),
		castle: vi.fn(),
		promote: vi.fn(),
		check: vi.fn(),
		gameStart: vi.fn(),
		gameEnd: vi.fn(),
		draw: vi.fn(),
		lowTime: vi.fn(),
		lowTimeTick: vi.fn(),
		getSoundPack: vi.fn().mockReturnValue("wood"),
		setSoundPack: vi.fn(),
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

describe("ChessBoard - Move Confirmation (#493)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		useGameStore.setState({
			gameCode: "TEST123",
			playerColor: "white",
			playerAddress: "G123456789...",
			board: mockBoard,
			currentTurn: "white",
			status: "active",
			isMoveConfirmationEnabled: false,
			moveHistory: [],
			selectedSquare: null,
			wagerAmount: null,
			tokenAddress: null,
			escrowStatus: null,
			inCheck: false,
			winner: null,
			endReason: null,
			drawOffer: null,
		});
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("does not show confirmation overlay when move confirmation is disabled", async () => {
		useGameStore.setState({ isMoveConfirmationEnabled: false });
		const { container } = renderChessBoard();

		// Click on e2 pawn
		const e2Square = container.querySelector('[data-testid="square-6-4"]');
		fireEvent.click(e2Square!);

		// Click on e4 to move there
		const e4Square = container.querySelector('[data-testid="square-4-4"]');
		fireEvent.click(e4Square!);

		// Wait for move to complete
		await waitFor(() => {
			// Confirmation overlay should not exist
			expect(screen.queryByTitle("Confirm move")).toBeFalsy();
			expect(screen.queryByTitle("Cancel move")).toBeFalsy();
		});
	});

	it("shows confirmation overlay when move confirmation is enabled and move is attempted", async () => {
		useGameStore.setState({ isMoveConfirmationEnabled: true });
		const { container } = renderChessBoard();

		// Click on e2 pawn
		const e2Square = container.querySelector('[data-testid="square-6-4"]');
		fireEvent.click(e2Square!);

		// Click on e4 to move there
		const e4Square = container.querySelector('[data-testid="square-4-4"]');
		fireEvent.click(e4Square!);

		// Confirmation overlay should be visible
		await waitFor(() => {
			expect(screen.getByTitle("Confirm move")).toBeTruthy();
			expect(screen.getByTitle("Cancel move")).toBeTruthy();
		});
	});

	it("confirms the move when confirm button is clicked", async () => {
		useGameStore.setState({ isMoveConfirmationEnabled: true });
		const makeMoveMock = vi.fn().mockResolvedValue({
			success: true,
			data: {
				board_state: mockBoard,
				current_turn: "black",
				status: "active",
				in_check: false,
				winner: null,
				end_reason: null,
				draw_offer: null,
				captured_white: [],
				captured_black: [],
				last_move: { from: [6, 4], to: [4, 4], piece: "P" },
			},
		});

		vi.doMock("../src/api/gameApi", () => ({
			api: {
				makeMove: makeMoveMock,
				getMoves: vi.fn().mockResolvedValue({ success: true, data: [] }),
				getGame: vi.fn().mockResolvedValue({
					success: true,
					data: {
						status: "active",
						time_control_seconds: 600,
					},
				}),
			},
		}));

		const { container } = renderChessBoard();

		// Select e2 pawn
		const e2Square = container.querySelector('[data-testid="square-6-4"]');
		fireEvent.click(e2Square!);

		// Move to e4
		const e4Square = container.querySelector('[data-testid="square-4-4"]');
		fireEvent.click(e4Square!);

		// Wait for confirmation buttons to appear
		await waitFor(() => {
			expect(screen.getByTitle("Confirm move")).toBeTruthy();
		});

		// Click confirm button
		const confirmButton = screen.getByTitle("Confirm move");
		fireEvent.click(confirmButton);

		// Confirmation overlay should disappear
		await waitFor(() => {
			expect(screen.queryByTitle("Confirm move")).toBeFalsy();
		});
	});

	it("cancels the move when cancel button is clicked", async () => {
		useGameStore.setState({ isMoveConfirmationEnabled: true });
		const { container } = renderChessBoard();

		// Select e2 pawn
		const e2Square = container.querySelector('[data-testid="square-6-4"]');
		fireEvent.click(e2Square!);

		// Move to e4
		const e4Square = container.querySelector('[data-testid="square-4-4"]');
		fireEvent.click(e4Square!);

		// Wait for confirmation buttons
		await waitFor(() => {
			expect(screen.getByTitle("Confirm move")).toBeTruthy();
		});

		// Click cancel button
		const cancelButton = screen.getByTitle("Cancel move");
		fireEvent.click(cancelButton);

		// Confirmation overlay should disappear
		await waitFor(() => {
			expect(screen.queryByTitle("Confirm move")).toBeFalsy();
			expect(screen.queryByTitle("Cancel move")).toBeFalsy();
		});

		// Selected square should be cleared
		const selectedSquare = useGameStore.getState().selectedSquare;
		expect(selectedSquare).toBeNull();
	});

	it("restores piece to original square when move is cancelled", async () => {
		useGameStore.setState({ isMoveConfirmationEnabled: true });
		const { container } = renderChessBoard();

		// Select e2 pawn
		const e2Square = container.querySelector('[data-testid="square-6-4"]');
		fireEvent.click(e2Square!);

		// Initial selected square should be e2
		let state = useGameStore.getState();
		expect(state.selectedSquare).toEqual([6, 4]);

		// Move to e4
		const e4Square = container.querySelector('[data-testid="square-4-4"]');
		fireEvent.click(e4Square!);

		// Confirmation should show
		await waitFor(() => {
			expect(screen.getByTitle("Confirm move")).toBeTruthy();
		});

		// Cancel the move
		const cancelButton = screen.getByTitle("Cancel move");
		fireEvent.click(cancelButton);

		// Selected square should be cleared
		await waitFor(() => {
			state = useGameStore.getState();
			expect(state.selectedSquare).toBeNull();
		});
	});

	it("confirmation overlay has correct styling and position", async () => {
		useGameStore.setState({ isMoveConfirmationEnabled: true });
		const { container } = renderChessBoard();

		// Select e2 pawn
		const e2Square = container.querySelector('[data-testid="square-6-4"]');
		fireEvent.click(e2Square!);

		// Move to e4
		const e4Square = container.querySelector('[data-testid="square-4-4"]');
		fireEvent.click(e4Square!);

		// Wait for confirmation overlay
		await waitFor(() => {
			expect(screen.getByTitle("Confirm move")).toBeTruthy();
		});

		// Check confirm button styling
		const confirmButton = screen.getByTitle("Confirm move") as HTMLButtonElement;
		expect(confirmButton.className).toContain("bg-emerald-600");
		expect(confirmButton.className).toContain("rounded-full");

		// Check cancel button styling
		const cancelButton = screen.getByTitle("Cancel move") as HTMLButtonElement;
		expect(cancelButton.className).toContain("bg-rose-600");
		expect(cancelButton.className).toContain("rounded-full");
	});

	it("confirmation buttons have proper icons", async () => {
		useGameStore.setState({ isMoveConfirmationEnabled: true });
		const { container } = renderChessBoard();

		// Select e2 pawn
		const e2Square = container.querySelector('[data-testid="square-6-4"]');
		fireEvent.click(e2Square!);

		// Move to e4
		const e4Square = container.querySelector('[data-testid="square-4-4"]');
		fireEvent.click(e4Square!);

		// Wait for confirmation buttons
		await waitFor(() => {
			const confirmButton = screen.getByTitle("Confirm move");
			const cancelButton = screen.getByTitle("Cancel move");

			// Both buttons should have SVG icons
			expect(confirmButton.querySelector("svg")).toBeTruthy();
			expect(cancelButton.querySelector("svg")).toBeTruthy();
		});
	});

	it("toggle move confirmation setting persists across rerenders", () => {
		const { rerender } = renderChessBoard();

		// Enable move confirmation
		useGameStore.setState({ isMoveConfirmationEnabled: true });
		let state = useGameStore.getState();
		expect(state.isMoveConfirmationEnabled).toBe(true);

		// Rerender component
		rerender(
			<BrowserRouter>
				<ChessBoard />
			</BrowserRouter>,
		);

		// Setting should still be enabled
		state = useGameStore.getState();
		expect(state.isMoveConfirmationEnabled).toBe(true);

		// Disable move confirmation
		useGameStore.setState({ isMoveConfirmationEnabled: false });
		state = useGameStore.getState();
		expect(state.isMoveConfirmationEnabled).toBe(false);

		// Rerender component
		rerender(
			<BrowserRouter>
				<ChessBoard />
			</BrowserRouter>,
		);

		// Setting should still be disabled
		state = useGameStore.getState();
		expect(state.isMoveConfirmationEnabled).toBe(false);
	});

	it("move is not sent to socket when confirmation is pending", async () => {
		useGameStore.setState({ isMoveConfirmationEnabled: true });
		const makeMoveApiMock = vi.mocked((await import("../src/api/gameApi")).api.makeMove);

		const { container } = renderChessBoard();

		// Select e2 pawn
		const e2Square = container.querySelector('[data-testid="square-6-4"]');
		fireEvent.click(e2Square!);

		// Move to e4
		const e4Square = container.querySelector('[data-testid="square-4-4"]');
		fireEvent.click(e4Square!);

		// Wait for confirmation overlay
		await waitFor(() => {
			expect(screen.getByTitle("Confirm move")).toBeTruthy();
		});

		// makeMove API should not have been called yet
		expect(makeMoveApiMock).not.toHaveBeenCalled();
	});

	it("move is sent to socket after confirmation is accepted", async () => {
		useGameStore.setState({ isMoveConfirmationEnabled: true });
		const { container } = renderChessBoard();

		// Select e2 pawn
		const e2Square = container.querySelector('[data-testid="square-6-4"]');
		fireEvent.click(e2Square!);

		// Move to e4
		const e4Square = container.querySelector('[data-testid="square-4-4"]');
		fireEvent.click(e4Square!);

		// Wait for confirmation overlay
		await waitFor(() => {
			expect(screen.getByTitle("Confirm move")).toBeTruthy();
		});

		// Click confirm button
		const confirmButton = screen.getByTitle("Confirm move");
		fireEvent.click(confirmButton);

		// Move should be processed
		await waitFor(() => {
			expect(screen.queryByTitle("Confirm move")).toBeFalsy();
		});
	});

	it("confirmation does not appear when toggle is disabled mid-game", async () => {
		useGameStore.setState({ isMoveConfirmationEnabled: false });
		const { container } = renderChessBoard();

		// Select e2 pawn
		const e2Square = container.querySelector('[data-testid="square-6-4"]');
		fireEvent.click(e2Square!);

		// Move to e4
		const e4Square = container.querySelector('[data-testid="square-4-4"]');
		fireEvent.click(e4Square!);

		// No confirmation should appear
		await waitFor(() => {
			expect(screen.queryByTitle("Confirm move")).toBeFalsy();
		}, { timeout: 1000 });
	});
});

describe("GameSettings - Move Confirmation Toggle", () => {
	beforeEach(() => {
		useGameStore.setState({
			gameCode: "TEST123",
			playerColor: "white",
			board: mockBoard,
			currentTurn: "white",
			status: "active",
			isMoveConfirmationEnabled: false,
			isSettingsOpen: false,
		});
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("toggle switch is rendered in game settings", () => {
		useGameStore.setState({ isSettingsOpen: true });
		renderChessBoard();

		// Look for move confirmation label in settings
		const moveConfirmationLabel = screen.getByText(/Move Confirmation/i);
		expect(moveConfirmationLabel).toBeTruthy();
	});

	it("toggle switch reflects current state", () => {
		useGameStore.setState({ isSettingsOpen: true, isMoveConfirmationEnabled: true });
		const { rerender } = renderChessBoard();

		// Find toggle switch (it's a button with role="switch")
		let toggleButtons = screen.getAllByRole("switch");
		const moveConfirmationToggle = toggleButtons.find((btn) =>
			btn.getAttribute("aria-label")?.includes("move confirmation"),
		);

		expect(moveConfirmationToggle).toBeTruthy();
		expect(moveConfirmationToggle?.getAttribute("aria-checked")).toBe("true");

		// Disable it
		useGameStore.setState({ isMoveConfirmationEnabled: false });
		rerender(
			<BrowserRouter>
				<ChessBoard />
			</BrowserRouter>,
		);

		toggleButtons = screen.getAllByRole("switch");
		const updatedToggle = toggleButtons.find((btn) =>
			btn.getAttribute("aria-label")?.includes("move confirmation"),
		);

		expect(updatedToggle?.getAttribute("aria-checked")).toBe("false");
	});

	it("toggle switch can be clicked to change state", () => {
		useGameStore.setState({ isSettingsOpen: true, isMoveConfirmationEnabled: false });
		renderChessBoard();

		const toggleButtons = screen.getAllByRole("switch");
		const moveConfirmationToggle = toggleButtons.find((btn) =>
			btn.getAttribute("aria-label")?.includes("move confirmation"),
		) as HTMLButtonElement;

		expect(moveConfirmationToggle).toBeTruthy();

		// Click to enable
		fireEvent.click(moveConfirmationToggle);

		// State should be updated
		let state = useGameStore.getState();
		expect(state.isMoveConfirmationEnabled).toBe(true);

		// Click to disable
		fireEvent.click(moveConfirmationToggle);

		state = useGameStore.getState();
		expect(state.isMoveConfirmationEnabled).toBe(false);
	});

	it("setting description explains the feature", () => {
		useGameStore.setState({ isSettingsOpen: true });
		renderChessBoard();

		const description = screen.getByText(/Require confirmation before committing moves/i);
		expect(description).toBeTruthy();
	});
});
