import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../api/gameApi", () => ({
	api: {
		createGame: vi.fn(),
		joinGame: vi.fn(),
		getGame: vi.fn(),
		makeMove: vi.fn(),
		getMoves: vi.fn(),
		getChatHistory: vi.fn(),
		resignGame: vi.fn(),
		offerDraw: vi.fn(),
		acceptDraw: vi.fn(),
	},
}));

vi.mock("../../api/socket", () => ({
	socketService: {
		connect: vi.fn(),
		disconnect: vi.fn(),
		joinGame: vi.fn(),
		leaveGame: vi.fn(),
		onGameUpdate: vi.fn(),
		offGameUpdate: vi.fn(),
		onChatMessage: vi.fn(),
		offChatMessage: vi.fn(),
		sendChatMessage: vi.fn(),
		onRematchRequested: vi.fn(),
		offRematchRequested: vi.fn(),
	},
}));

import { useGameStore } from "../gameStore";
import { api } from "../../api/gameApi";
import { socketService } from "../../api/socket";

const mockedApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>;
const mockedSocket = socketService as unknown as Record<string, ReturnType<typeof vi.fn>>;

const emptyBoard = () => Array.from({ length: 8 }, () => Array(8).fill("."));

function baseGameData(overrides: Record<string, unknown> = {}) {
	return {
		success: true,
		data: {
			board_state: emptyBoard(),
			current_turn: "white",
			status: "waiting",
			...overrides,
		},
	};
}

describe("gameStore", () => {
	beforeEach(() => {
		// Stop any leftover interval and reset to a clean baseline before each test.
		useGameStore.getState().leaveGame();
		localStorage.clear();
		vi.clearAllMocks();
		mockedApi.getGame.mockResolvedValue(baseGameData());
		mockedApi.getMoves.mockResolvedValue({ success: true, data: [] });
		mockedApi.getChatHistory.mockResolvedValue({ success: true, data: [] });
	});

	afterEach(() => {
		useGameStore.getState().leaveGame();
		localStorage.clear();
	});

	describe("createGame", () => {
		it("joins as white once the game is created", async () => {
			mockedApi.createGame.mockResolvedValue({
				success: true,
				data: { game_code: "ABC123" },
			});
			mockedApi.joinGame.mockResolvedValue({ success: true, data: {} });

			await useGameStore.getState().createGame("GADDRESS", "10", 600, 0);

			expect(mockedApi.createGame).toHaveBeenCalledWith(
				"chess",
				"GADDRESS",
				"10",
				600,
				undefined,
				0,
			);
			const state = useGameStore.getState();
			expect(state.gameCode).toBe("ABC123");
			expect(state.playerColor).toBe("white");
			expect(state.playerAddress).toBe("GADDRESS");
		});

		it("throws with the server error when creation fails", async () => {
			mockedApi.createGame.mockResolvedValue({
				success: false,
				error: "Wager too low",
			});

			await expect(
				useGameStore.getState().createGame("GADDRESS"),
			).rejects.toThrow("Wager too low");
			expect(mockedApi.joinGame).not.toHaveBeenCalled();
		});
	});

	describe("joinGame", () => {
		it("stores player info and loads game/move/chat state on success", async () => {
			mockedApi.joinGame.mockResolvedValue({ success: true, data: {} });

			await useGameStore.getState().joinGame("GAME1", "black", "GADDR");

			const state = useGameStore.getState();
			expect(state.gameCode).toBe("GAME1");
			expect(state.playerColor).toBe("black");
			expect(state.playerAddress).toBe("GADDR");
			expect(mockedApi.getGame).toHaveBeenCalledWith("GAME1");
			expect(mockedApi.getMoves).toHaveBeenCalledWith("GAME1");
			expect(mockedApi.getChatHistory).toHaveBeenCalledWith("GAME1");
			expect(mockedSocket.connect).toHaveBeenCalled();
			expect(mockedSocket.joinGame).toHaveBeenCalledWith("GAME1");
		});

		it("throws the server error and leaves state untouched when the join is rejected", async () => {
			mockedApi.joinGame.mockResolvedValue({
				success: false,
				error: "Game is full",
			});

			await expect(
				useGameStore.getState().joinGame("GAME1", "black", "GADDR"),
			).rejects.toThrow("Game is full");
			expect(useGameStore.getState().gameCode).toBeNull();
		});
	});

	describe("makeMove", () => {
		it("does nothing when there is no active game code", async () => {
			await useGameStore.getState().makeMove([6, 4], [4, 4]);
			expect(mockedApi.makeMove).not.toHaveBeenCalled();
		});

		it("applies the returned board state on a successful move", async () => {
			useGameStore.setState({ gameCode: "GAME1" });
			mockedApi.makeMove.mockResolvedValue(
				baseGameData({ status: "active", current_turn: "black" }),
			);

			await useGameStore.getState().makeMove([6, 4], [4, 4]);

			const state = useGameStore.getState();
			expect(mockedApi.makeMove).toHaveBeenCalledWith(
				"GAME1",
				[6, 4],
				[4, 4],
				undefined,
			);
			expect(state.currentTurn).toBe("black");
			expect(state.selectedSquare).toBeNull();
		});

		it("throws the server error for an illegal move", async () => {
			useGameStore.setState({ gameCode: "GAME1" });
			mockedApi.makeMove.mockResolvedValue({
				success: false,
				error: "Illegal move",
			});

			await expect(
				useGameStore.getState().makeMove([0, 0], [0, 1]),
			).rejects.toThrow("Illegal move");
		});
	});

	describe("resignGame / offerDraw / acceptDraw", () => {
		it("resignGame updates status and winner on success", async () => {
			useGameStore.setState({ gameCode: "GAME1", playerColor: "white" });
			mockedApi.resignGame.mockResolvedValue({
				success: true,
				data: { status: "finished", winner: "black", end_reason: "resignation" },
			});

			await useGameStore.getState().resignGame();

			const state = useGameStore.getState();
			expect(state.status).toBe("finished");
			expect(state.winner).toBe("black");
			expect(state.endReason).toBe("resignation");
		});

		it("resignGame leaves state untouched when the request fails", async () => {
			useGameStore.setState({ gameCode: "GAME1", playerColor: "white", status: "active" });
			mockedApi.resignGame.mockResolvedValue({ success: false, error: "Not your game" });

			await useGameStore.getState().resignGame();

			expect(useGameStore.getState().status).toBe("active");
		});

		it("resignGame is a no-op without an active game", async () => {
			await useGameStore.getState().resignGame();
			expect(mockedApi.resignGame).not.toHaveBeenCalled();
		});

		it("offerDraw records the draw offer on success", async () => {
			useGameStore.setState({ gameCode: "GAME1", playerColor: "white" });
			mockedApi.offerDraw.mockResolvedValue({
				success: true,
				data: { status: "active", draw_offer: "white" },
			});

			await useGameStore.getState().offerDraw();

			expect(useGameStore.getState().drawOffer).toBe("white");
		});

		it("acceptDraw finishes the game as a draw on success", async () => {
			useGameStore.setState({ gameCode: "GAME1" });
			mockedApi.acceptDraw.mockResolvedValue({
				success: true,
				data: { status: "finished", winner: "draw", end_reason: "draw_agreed" },
			});

			await useGameStore.getState().acceptDraw();

			const state = useGameStore.getState();
			expect(state.status).toBe("finished");
			expect(state.winner).toBe("draw");
		});
	});

	describe("leaveGame / reset", () => {
		it("tears down the socket connection and clears game state", () => {
			useGameStore.setState({
				gameCode: "GAME1",
				playerColor: "white",
				status: "active",
				chatMessages: [{ id: "1", playerColor: "white", message: "hi", createdAt: "now" }],
			});

			useGameStore.getState().leaveGame();

			expect(mockedSocket.leaveGame).toHaveBeenCalledWith("GAME1");
			expect(mockedSocket.disconnect).toHaveBeenCalled();
			const state = useGameStore.getState();
			expect(state.gameCode).toBeNull();
			expect(state.playerColor).toBeNull();
			expect(state.chatMessages).toEqual([]);
		});

		it("does not touch the socket when there is no active game", () => {
			useGameStore.getState().leaveGame();
			expect(mockedSocket.leaveGame).not.toHaveBeenCalled();
		});

		it("reset delegates to leaveGame", () => {
			useGameStore.setState({ gameCode: "GAME1" });
			useGameStore.getState().reset();
			expect(useGameStore.getState().gameCode).toBeNull();
		});
	});

	describe("selectSquare / setViewingIndex", () => {
		it("updates the selected square", () => {
			useGameStore.getState().selectSquare([2, 3]);
			expect(useGameStore.getState().selectedSquare).toEqual([2, 3]);

			useGameStore.getState().selectSquare(null);
			expect(useGameStore.getState().selectedSquare).toBeNull();
		});

		it("setViewingIndex also clears any selected square", () => {
			useGameStore.setState({ selectedSquare: [1, 1] });
			useGameStore.getState().setViewingIndex(3);

			const state = useGameStore.getState();
			expect(state.viewingIndex).toBe(3);
			expect(state.selectedSquare).toBeNull();
		});
	});

	describe("chat", () => {
		it("sendChatMessage is a no-op without a joined game", () => {
			useGameStore.getState().sendChatMessage("hello");
			expect(mockedSocket.sendChatMessage).not.toHaveBeenCalled();
		});

		it("sendChatMessage emits over the socket once joined", () => {
			useGameStore.setState({ gameCode: "GAME1", playerColor: "white" });
			useGameStore.getState().sendChatMessage("hello");
			expect(mockedSocket.sendChatMessage).toHaveBeenCalledWith("GAME1", "white", "hello");
		});

		it("addChatMessage increments unreadCount while the panel is closed", () => {
			useGameStore.setState({ chatOpen: false, unreadCount: 0, chatMessages: [] });
			useGameStore.getState().addChatMessage({
				id: "1",
				playerColor: "black",
				message: "gg",
				createdAt: "now",
			});

			const state = useGameStore.getState();
			expect(state.chatMessages).toHaveLength(1);
			expect(state.unreadCount).toBe(1);
		});

		it("addChatMessage does not increment unreadCount while the panel is open", () => {
			useGameStore.setState({ chatOpen: true, unreadCount: 0, chatMessages: [] });
			useGameStore.getState().addChatMessage({
				id: "1",
				playerColor: "black",
				message: "gg",
				createdAt: "now",
			});

			expect(useGameStore.getState().unreadCount).toBe(0);
		});

		it("setChatOpen(true) clears the unread counter", () => {
			useGameStore.setState({ unreadCount: 5 });
			useGameStore.getState().setChatOpen(true);

			const state = useGameStore.getState();
			expect(state.chatOpen).toBe(true);
			expect(state.unreadCount).toBe(0);
		});
	});

	describe("toggleBlindfoldMode", () => {
		it("flips isBlindfoldMode", () => {
			useGameStore.setState({ isBlindfoldMode: false });
			useGameStore.getState().toggleBlindfoldMode();
			expect(useGameStore.getState().isBlindfoldMode).toBe(true);
		});
	});
});
