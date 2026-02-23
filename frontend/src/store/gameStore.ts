import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useEffect } from "react";
import { api } from "../api/gameApi";
import { socketService } from "../api/socket";
import { useToastStore } from "./toastStore";
import type { GameState } from "../types/game";

interface GameStore {
	gameCode: string | null;
	playerColor: "white" | "black" | null;
	board: string[][];
	currentTurn: "white" | "black";
	status: string;
	inCheck?: boolean;
	winner?: string | null;
	drawOffer?: string | null;
	turnStartedAt?: string | null;
	secondsLeft: number;
	capturedWhite?: string[];
	capturedBlack?: string[];
	lastMove?: {
		from: [number, number];
		to: [number, number];
		piece: string;
	} | null;
	selectedSquare: [number, number] | null;
	// Escrow / wager info (populated from fetched game state)
	wagerAmount?: number | string | null;
	tokenAddress?: string | null;
	escrowStatus?: string | null;
	escrowCreateTx?: string | null;
	escrowJoinTx?: string | null;
	escrowResolveTx?: string | null;

	createGame: (
		walletAddress: string,
		wagerAmount?: string,
	) => Promise<void>;
	joinGame: (code: string, color: "white" | "black", walletAddress: string) => Promise<void>;
	rejoinGame: (code: string) => Promise<void>;
	fetchGameState: () => Promise<void>;
	makeMove: (
		from: [number, number],
		to: [number, number],
		promotion?: string,
	) => Promise<void>;
	selectSquare: (pos: [number, number] | null) => void;
	updateGameState: (data: GameState) => void;
	resignGame: () => Promise<void>;
	offerDraw: () => Promise<void>;
	acceptDraw: () => Promise<void>;
	leaveGame: () => void;
	reset: () => void;
}

export const useGameStore = create<GameStore>()(
	persist(
		(set, get) => ({
			gameCode: null,
			playerColor: null,
			board: [],
			currentTurn: "white",
			status: "",
			inCheck: false,
			winner: null,
			drawOffer: null,
			turnStartedAt: null,
			secondsLeft: 45,
			capturedWhite: [],
			capturedBlack: [],
			lastMove: null,
			selectedSquare: null,
			wagerAmount: null,
			tokenAddress: null,
			escrowStatus: null,
			escrowCreateTx: null,
			escrowJoinTx: null,
			escrowResolveTx: null,

			createGame: async (
				walletAddress: string,
				wagerAmount?: string,
			) => {
				const data = await api.createGame("chess", walletAddress, wagerAmount);
				if (data.success) {
					await get().joinGame(data.data.game_code, "white", walletAddress);
				} else {
					throw new Error(data.error || "Failed to create game");
				}
			},

			joinGame: async (code: string, color: "white" | "black", walletAddress: string) => {
				const data = await api.joinGame(code, color, walletAddress);
				if (data.success) {
					set({ gameCode: code, playerColor: color });
					await get().fetchGameState();

					socketService.connect();
					socketService.joinGame(code);
					socketService.onGameUpdate((gameData) => {
						get().updateGameState(gameData);
					});
					socketService.onTimerTick(({ secondsLeft }) => {
						set({ secondsLeft });
					});
				} else {
					throw new Error(data.error);
				}
			},

			rejoinGame: async (code: string) => {
				const { playerColor } = get();
				if (!playerColor) return;

				const data = await api.getGame(code);
				if (data.success) {
					set({
						gameCode: code,
						board: data.data.board_state,
						currentTurn: data.data.current_turn,
						status: data.data.status,
						inCheck: data.data.in_check ?? false,
						winner: data.data.winner ?? null,
						drawOffer: data.data.draw_offer ?? null,
						turnStartedAt: data.data.turn_started_at ?? null,
						capturedWhite: data.data.captured_white ?? [],
						capturedBlack: data.data.captured_black ?? [],
						lastMove: data.data.last_move ?? null,
						wagerAmount: data.data.wager_amount ?? null,
						tokenAddress: data.data.token_address ?? null,
						escrowStatus: data.data.escrow_status ?? null,
						escrowCreateTx: data.data.escrow_create_tx ?? null,
						escrowJoinTx: data.data.escrow_join_tx ?? null,
						escrowResolveTx: data.data.escrow_resolve_tx ?? null,
					});

					socketService.connect();
					socketService.joinGame(code);
					socketService.onGameUpdate((gameData) => {
						get().updateGameState(gameData);
					});
					socketService.onTimerTick(({ secondsLeft }) => {
						set({ secondsLeft });
					});
				} else {
					throw new Error(data.error);
				}
			},

			fetchGameState: async () => {
				const { gameCode } = get();
				if (!gameCode) return;

				const data = await api.getGame(gameCode);
				if (data.success) {
					set({
						board: data.data.board_state,
						currentTurn: data.data.current_turn,
						status: data.data.status,
						inCheck: data.data.in_check ?? false,
						winner: data.data.winner ?? null,
						drawOffer: data.data.draw_offer ?? null,
						turnStartedAt: data.data.turn_started_at ?? null,
						capturedWhite: data.data.captured_white ?? [],
						capturedBlack: data.data.captured_black ?? [],
						lastMove: data.data.last_move ?? null,
						wagerAmount: data.data.wager_amount ?? null,
						tokenAddress: data.data.token_address ?? null,
						escrowStatus: data.data.escrow_status ?? null,
						escrowCreateTx: data.data.escrow_create_tx ?? null,
						escrowJoinTx: data.data.escrow_join_tx ?? null,
						escrowResolveTx: data.data.escrow_resolve_tx ?? null,
					});
				}
			},

			makeMove: async (
				from: [number, number],
				to: [number, number],
				promotion?: string,
			) => {
				const { gameCode } = get();
				if (!gameCode) return;

				const data = await api.makeMove(gameCode, from, to, promotion);
				if (data.success) {
					set({
						board: data.data.board_state,
						currentTurn: data.data.current_turn,
						status: data.data.status,
						inCheck: data.data.in_check ?? false,
						winner: data.data.winner ?? null,
						drawOffer: data.data.draw_offer ?? null,
						turnStartedAt: data.data.turn_started_at ?? null,
						capturedWhite: data.data.captured_white ?? [],
						capturedBlack: data.data.captured_black ?? [],
						lastMove: data.data.last_move ?? null,
						selectedSquare: null,
					});
				} else {
					throw new Error(data.error);
				}
			},

			updateGameState: (data: GameState) => {
				set({
					board: data.board_state,
					currentTurn: data.current_turn,
					status: data.status,
					inCheck: data.in_check ?? false,
					winner: data.winner ?? null,
					drawOffer: data.draw_offer ?? null,
					turnStartedAt: data.turn_started_at ?? null,
					capturedWhite: data.captured_white ?? [],
					capturedBlack: data.captured_black ?? [],
					lastMove: data.last_move ?? null,
					wagerAmount: data.wager_amount ?? null,
					tokenAddress: data.token_address ?? null,
					escrowStatus: data.escrow_status ?? null,
					escrowCreateTx: data.escrow_create_tx ?? null,
					escrowJoinTx: data.escrow_join_tx ?? null,
					escrowResolveTx: data.escrow_resolve_tx ?? null,
				});
			},

			selectSquare: (pos: [number, number] | null) =>
				set({ selectedSquare: pos }),

			resignGame: async () => {
				const { gameCode, playerColor } = get();
				if (!gameCode || !playerColor) return;
				const data = await api.resignGame(gameCode, playerColor);
				if (data.success) {
					set({ status: data.data.status });
				}
			},

			offerDraw: async () => {
				const { gameCode, playerColor } = get();
				if (!gameCode || !playerColor) return;
				const data = await api.offerDraw(gameCode, playerColor);
				if (data.success) {
					set({ status: data.data.status, drawOffer: data.data.draw_offer ?? null });
				}
			},

			acceptDraw: async () => {
				const { gameCode } = get();
				if (!gameCode) return;
				const data = await api.acceptDraw(gameCode);
				if (data.success) {
					set({ status: data.data.status });
				}
			},

			leaveGame: () => {
				const { gameCode } = get();
				if (gameCode) {
					socketService.leaveGame(gameCode);
					socketService.offGameUpdate();
					socketService.offTimerTick();
					socketService.disconnect();
				}
				set({
					gameCode: null,
					playerColor: null,
					board: [],
					currentTurn: "white",
					status: "",
					secondsLeft: 45,
					selectedSquare: null,
					wagerAmount: null,
					tokenAddress: null,
					escrowStatus: null,
					escrowCreateTx: null,
					escrowJoinTx: null,
					escrowResolveTx: null,
				});
			},

			reset: () => {
				get().leaveGame();
			},
		}),
		{
			name: "chesster-game",
			partialize: (state) => ({
				gameCode: state.gameCode,
				playerColor: state.playerColor,
			}),
		},
	),
);

// Hook to manage game notifications (toasts) triggered by state changes
export const useGameNotifications = () => {
	const addToast = useToastStore((s) => s.addToast);
	const status = useGameStore((s) => s.status);
	const winner = useGameStore((s) => s.winner);
	const playerColor = useGameStore((s) => s.playerColor);
	const inCheck = useGameStore((s) => s.inCheck);
	const currentTurn = useGameStore((s) => s.currentTurn);
	const drawOffer = useGameStore((s) => s.drawOffer);
	const wagerAmount = useGameStore((s) => s.wagerAmount);
	const fetchGameState = useGameStore((s) => s.fetchGameState);

	useEffect(() => {
		if (status === "finished") {
			if (winner === "draw") {
				addToast("Game ended in a draw!", "info");
			} else if (winner === playerColor) {
				addToast("You won! Checkmate!", "success");
			} else {
				addToast("You lost. Checkmate!", "error");
			}
			// Re-fetch so escrow tx hashes (written after resolution) are picked up
			if (wagerAmount) {
				setTimeout(() => fetchGameState(), 3000);
			}
		}
	}, [status, winner, playerColor, wagerAmount, fetchGameState, addToast]);

	useEffect(() => {
		if (inCheck && currentTurn === playerColor && status === "active") {
			addToast("Your king is in check!", "error");
		}
	}, [inCheck, currentTurn, playerColor, status, addToast]);

	useEffect(() => {
		if (drawOffer && drawOffer !== playerColor && status === "active") {
			addToast("Opponent offered a draw", "info");
		}
	}, [drawOffer, playerColor, status, addToast]);
};
