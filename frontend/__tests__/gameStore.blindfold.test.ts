import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useGameStore } from "../src/store/gameStore";

describe("Game Store - Blindfold Mode", () => {
	beforeEach(() => {
		// Reset store to initial state
		useGameStore.setState({
			gameCode: null,
			playerColor: null,
			playerAddress: null,
			board: [],
			currentTurn: "white",
			status: "",
			inCheck: false,
			winner: null,
			endReason: null,
			drawOffer: null,
			turnStartedAt: null,
			secondsLeft: 600,
			timeControlSeconds: 600,
			capturedWhite: [],
			capturedBlack: [],
			lastMove: null,
			selectedSquare: null,
			moveHistory: [],
			viewingIndex: null,
			wagerAmount: null,
			tokenAddress: null,
			escrowStatus: null,
			escrowCreateTx: null,
			escrowJoinTx: null,
			escrowResolveTx: null,
			chatMessages: [],
			unreadCount: 0,
			chatOpen: false,
			isBlindfoldMode: false,
		});
		// Clear localStorage
		localStorage.clear();
	});

	afterEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
	});

	it("initializes with isBlindfoldMode as false", () => {
		const state = useGameStore.getState();
		expect(state.isBlindfoldMode).toBe(false);
	});

	it("toggles isBlindfoldMode from false to true", () => {
		const { toggleBlindfoldMode } = useGameStore.getState();
		expect(useGameStore.getState().isBlindfoldMode).toBe(false);

		toggleBlindfoldMode();
		expect(useGameStore.getState().isBlindfoldMode).toBe(true);
	});

	it("toggles isBlindfoldMode from true to false", () => {
		useGameStore.setState({ isBlindfoldMode: true });
		const { toggleBlindfoldMode } = useGameStore.getState();

		toggleBlindfoldMode();
		expect(useGameStore.getState().isBlindfoldMode).toBe(false);
	});

	it("persists isBlindfoldMode to localStorage", () => {
		const { toggleBlindfoldMode } = useGameStore.getState();
		toggleBlindfoldMode();

		const stored = localStorage.getItem("chesster-game");
		expect(stored).toBeTruthy();

		const parsed = JSON.parse(stored!);
		expect(parsed.isBlindfoldMode).toBe(true);
	});

	it("loads isBlindfoldMode from localStorage on store init", () => {
		// Simulate persisted state
		const persisted = {
			gameCode: null,
			playerColor: null,
			isBlindfoldMode: true,
		};
		localStorage.setItem("chesster-game", JSON.stringify(persisted));

		// Create a new store instance (simulating page reload)
		const newState = useGameStore.getState();
		// After hydration from persist, isBlindfoldMode should be true
		expect(newState.isBlindfoldMode).toBe(true);
	});

	it("correctly persists only isBlindfoldMode along with gameCode and playerColor", () => {
		useGameStore.setState({
			gameCode: "TEST123",
			playerColor: "white",
			isBlindfoldMode: true,
			capturedWhite: ["p", "p"], // Should NOT be persisted
			selectedSquare: [0, 0], // Should NOT be persisted
		});

		const stored = localStorage.getItem("chesster-game");
		const parsed = JSON.parse(stored!);

		expect(parsed).toHaveProperty("gameCode", "TEST123");
		expect(parsed).toHaveProperty("playerColor", "white");
		expect(parsed).toHaveProperty("isBlindfoldMode", true);
		expect(parsed).not.toHaveProperty("capturedWhite");
		expect(parsed).not.toHaveProperty("selectedSquare");
	});

	it("multiple rapid toggles work correctly", () => {
		const { toggleBlindfoldMode } = useGameStore.getState();

		toggleBlindfoldMode(); // true
		expect(useGameStore.getState().isBlindfoldMode).toBe(true);

		toggleBlindfoldMode(); // false
		expect(useGameStore.getState().isBlindfoldMode).toBe(false);

		toggleBlindfoldMode(); // true
		expect(useGameStore.getState().isBlindfoldMode).toBe(true);

		toggleBlindfoldMode(); // false
		expect(useGameStore.getState().isBlindfoldMode).toBe(false);
	});

	it("isBlindfoldMode does not persist other unrelated state changes", () => {
		useGameStore.setState({
			gameCode: "GAME1",
			isBlindfoldMode: true,
		});

		// Change something that shouldn't persist
		useGameStore.setState({ selectedSquare: [1, 1] });

		const stored = localStorage.getItem("chesster-game");
		const parsed = JSON.parse(stored!);

		expect(parsed.gameCode).toBe("GAME1");
		expect(parsed.isBlindfoldMode).toBe(true);
		expect(parsed).not.toHaveProperty("selectedSquare");
	});
});
