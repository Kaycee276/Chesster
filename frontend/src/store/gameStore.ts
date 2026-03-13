import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useEffect, useRef } from "react";
import { api } from "../api/gameApi";
import { socketService } from "../api/socket";
import { useToastStore } from "./toastStore";
import { soundService } from "../services/soundService";
import type { GameState } from "../types/game";

// ── Module-level local countdown timer ────────────────────────────────────────
let _timerInterval: ReturnType<typeof setInterval> | null = null;

function startLocalTimer() {
	if (_timerInterval !== null) return; // already running
	_timerInterval = setInterval(() => {
		useGameStore.setState((s) => {
			if (s.status !== "active") return s;
			return { secondsLeft: Math.max(0, s.secondsLeft - 1) };
		});
	}, 1000);
}

function stopLocalTimer() {
	if (_timerInterval !== null) {
		clearInterval(_timerInterval);
		_timerInterval = null;
	}
}

interface GameStore {
	gameCode: string | null;
	playerColor: "white" | "black" | null;
	playerAddress: string | null;
	board: string[][];
	currentTurn: "white" | "black";
	status: string;
	inCheck?: boolean;
	winner?: string | null;
	endReason?: string | null;
	drawOffer?: string | null;
	turnStartedAt?: string | null;
	secondsLeft: number;
	timeControlSeconds: number;
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
		timeControlSeconds?: number,
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
			wagerAmount: null,
			tokenAddress: null,
			escrowStatus: null,
			escrowCreateTx: null,
			escrowJoinTx: null,
			escrowResolveTx: null,

			createGame: async (
				walletAddress: string,
				wagerAmount?: string,
				timeControlSeconds?: number,
			) => {
				const data = await api.createGame("chess", walletAddress, wagerAmount, timeControlSeconds);
				if (data.success) {
					await get().joinGame(data.data.game_code, "white", walletAddress);
				} else {
					throw new Error(data.error || "Failed to create game");
				}
			},

			joinGame: async (code: string, color: "white" | "black", walletAddress: string) => {
				const data = await api.joinGame(code, color, walletAddress);
				if (data.success) {
					set({ gameCode: code, playerColor: color, playerAddress: walletAddress });
					await get().fetchGameState();

					socketService.connect();
					socketService.joinGame(code);
					socketService.onGameUpdate((gameData) => {
						get().updateGameState(gameData);
					});

					if (get().status === "active") {
						startLocalTimer();
					}
				} else {
					throw new Error(data.error);
				}
			},

			rejoinGame: async (code: string) => {
				const { playerColor } = get();
				if (!playerColor) return;

				const data = await api.getGame(code);
				if (data.success) {
					const tcs = data.data.time_control_seconds ?? 600;
					let secondsLeft = tcs;
					// Use game_started_at (set once when both players join) to compute
					// elapsed time — gives an accurate timer even after page reload.
					if (data.data.status === "active" && data.data.game_started_at) {
						const elapsed = Math.floor(
							(Date.now() - new Date(data.data.game_started_at).getTime()) / 1000,
						);
						secondsLeft = Math.max(0, tcs - elapsed);
					}
					set({
						gameCode: code,
						board: data.data.board_state,
						currentTurn: data.data.current_turn,
						status: data.data.status,
						inCheck: data.data.in_check ?? false,
						winner: data.data.winner ?? null,
						endReason: data.data.end_reason ?? null,
						drawOffer: data.data.draw_offer ?? null,
						turnStartedAt: data.data.turn_started_at ?? null,
						secondsLeft,
						timeControlSeconds: tcs,
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

					if (data.data.status === "active") {
						startLocalTimer();
					}
				} else {
					throw new Error(data.error);
				}
			},

			fetchGameState: async () => {
				const { gameCode, status: prevStatus } = get();
				if (!gameCode) return;

				const data = await api.getGame(gameCode);
				if (data.success) {
					const tcs = data.data.time_control_seconds ?? 600;
					const nextStatus = data.data.status;
					const isTransitionToActive = nextStatus === "active" && prevStatus === "waiting";

					// Single source of truth for the timer: game_started_at (set once
					// when both players join). Both clients compute the same secondsLeft
					// from the same origin timestamp.
					let secondsLeft = get().secondsLeft;
					if (nextStatus === "active" && data.data.game_started_at) {
						const elapsed = Math.floor(
							(Date.now() - new Date(data.data.game_started_at).getTime()) / 1000,
						);
						secondsLeft = Math.max(0, tcs - elapsed);
					}

					set({
						board: data.data.board_state,
						currentTurn: data.data.current_turn,
						status: nextStatus,
						inCheck: data.data.in_check ?? false,
						winner: data.data.winner ?? null,
						endReason: data.data.end_reason ?? null,
						drawOffer: data.data.draw_offer ?? null,
						turnStartedAt: data.data.turn_started_at ?? null,
						secondsLeft,
						timeControlSeconds: tcs,
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

					if (isTransitionToActive) {
						startLocalTimer();
					}

					if (nextStatus === "finished") {
						stopLocalTimer();
					}
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
						endReason: data.data.end_reason ?? null,
						drawOffer: data.data.draw_offer ?? null,
						turnStartedAt: data.data.turn_started_at ?? null,
						capturedWhite: data.data.captured_white ?? [],
						capturedBlack: data.data.captured_black ?? [],
						lastMove: data.data.last_move ?? null,
						selectedSquare: null,
					});
					if (data.data.status !== "active") {
						stopLocalTimer();
					}
				} else {
					throw new Error(data.error);
				}
			},

			updateGameState: (data: GameState) => {
				const tcs = data.time_control_seconds ?? get().timeControlSeconds;
				let secondsLeft = get().secondsLeft;
				if (data.status === "active" && data.game_started_at) {
					const elapsed = Math.floor(
						(Date.now() - new Date(data.game_started_at).getTime()) / 1000,
					);
					secondsLeft = Math.max(0, tcs - elapsed);
				}
				set({
					board: data.board_state,
					currentTurn: data.current_turn,
					status: data.status,
					inCheck: data.in_check ?? false,
					winner: data.winner ?? null,
					endReason: data.end_reason ?? null,
					drawOffer: data.draw_offer ?? null,
					turnStartedAt: data.turn_started_at ?? null,
					secondsLeft,
					timeControlSeconds: tcs,
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
				if (data.status !== "active") {
					stopLocalTimer();
				}
			},

			selectSquare: (pos: [number, number] | null) =>
				set({ selectedSquare: pos }),

			resignGame: async () => {
				const { gameCode, playerColor } = get();
				if (!gameCode || !playerColor) return;
				const data = await api.resignGame(gameCode, playerColor);
				if (data.success) {
					stopLocalTimer();
					set({ status: data.data.status, winner: data.data.winner ?? null });
				}
			},

			offerDraw: async () => {
				const { gameCode, playerColor, playerAddress } = get();
				if (!gameCode || !playerColor) return;
				const data = await api.offerDraw(gameCode, playerColor, playerAddress ?? undefined);
				if (data.success) {
					set({ status: data.data.status, drawOffer: data.data.draw_offer ?? null });
				}
			},

			acceptDraw: async () => {
				const { gameCode } = get();
				if (!gameCode) return;
				const data = await api.acceptDraw(gameCode);
				if (data.success) {
					stopLocalTimer();
					set({
						status: data.data.status,
						winner: data.data.winner ?? null,
						endReason: data.data.end_reason ?? null,
					});
				}
			},

			leaveGame: () => {
				const { gameCode } = get();
				stopLocalTimer();
				if (gameCode) {
					socketService.leaveGame(gameCode);
					socketService.offGameUpdate();
					socketService.disconnect();
				}
				set({
					gameCode: null,
					playerColor: null,
					playerAddress: null,
					board: [],
					currentTurn: "white",
					status: "",
					secondsLeft: 600,
					timeControlSeconds: 600,
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
	const endReason = useGameStore((s) => s.endReason);
	const playerColor = useGameStore((s) => s.playerColor);
	const gameCode = useGameStore((s) => s.gameCode);
	const inCheck = useGameStore((s) => s.inCheck);
	const currentTurn = useGameStore((s) => s.currentTurn);
	const drawOffer = useGameStore((s) => s.drawOffer);
	const wagerAmount = useGameStore((s) => s.wagerAmount);
	const escrowStatus = useGameStore((s) => s.escrowStatus);
	const fetchGameState = useGameStore((s) => s.fetchGameState);

	useEffect(() => {
		if (status !== "finished") return;

		const won = winner === playerColor;
		const isDraw = winner === "draw";

		if (isDraw) {
			const msg =
				endReason === "stalemate"   ? "Draw by stalemate!" :
				endReason === "draw_agreed" ? "Draw agreed — well played!" :
				endReason === "time"        ? "Time's up — equal material, it's a draw!" :
				"Game ended in a draw!";
			addToast(msg, "info");
		} else if (won) {
			const msg =
				endReason === "checkmate"   ? "You won by checkmate!" :
				endReason === "resignation" ? "You won — opponent resigned!" :
				endReason === "time"        ? "Time's up — you had more material!" :
				"You won!";
			addToast(msg, "success");
		} else {
			const msg =
				endReason === "checkmate"   ? "You lost by checkmate." :
				endReason === "resignation" ? "You resigned." :
				endReason === "time"        ? "Time's up — opponent had more material." :
				"You lost.";
			addToast(msg, "error");
		}
	}, [status, winner, endReason, playerColor, addToast]);

	// Poll for escrow settlement every 3 s until settled or failed
	useEffect(() => {
		if (status !== "finished" || !wagerAmount) return;
		if (escrowStatus === "settled" || escrowStatus === "failed") return;
		const id = setInterval(fetchGameState, 3000);
		return () => clearInterval(id);
	}, [status, wagerAmount, escrowStatus, fetchGameState]);

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

	// Poll the DB every 3 s while waiting for the opponent to join.
	// Clears automatically when status leaves "waiting".
	useEffect(() => {
		if (status !== "waiting" || !gameCode) return;
		const id = setInterval(fetchGameState, 3000);
		return () => clearInterval(id);
	}, [status, gameCode, fetchGameState]);

	// Poll the DB every 3 s while the game is active so opponent moves are
	// visible even when the Socket.IO game-update is missed/delayed.
	useEffect(() => {
		if (status !== "active" || !gameCode) return;
		const id = setInterval(fetchGameState, 3000);
		return () => clearInterval(id);
	}, [status, gameCode, fetchGameState]);

	// Notify Player 1 the moment their opponent joins.
	const prevStatusRef = useRef(status);
	useEffect(() => {
		if (prevStatusRef.current === "waiting" && status === "active") {
			addToast("Opponent joined — game on!", "success");
		}
		prevStatusRef.current = status;
	}, [status, addToast]);
};

// ── Sound effects hook ────────────────────────────────────────────────────────
export const useSoundEffects = () => {
	const lastMove      = useGameStore((s) => s.lastMove);
	const capturedWhite = useGameStore((s) => s.capturedWhite);
	const capturedBlack = useGameStore((s) => s.capturedBlack);
	const status        = useGameStore((s) => s.status);
	const inCheck       = useGameStore((s) => s.inCheck);

	const prevCapturedRef = useRef(0);
	const prevStatusRef   = useRef(status);
	const prevInCheckRef  = useRef(false);
	const prevMoveKeyRef  = useRef<string | null>(null);

	// Move / capture / castle / promote sounds
	useEffect(() => {
		if (!lastMove) return;

		// Deduplicate: polling sets lastMove to a new object every 3 s even when
		// no move was made. Compare by value so we only beep on a real new move.
		const moveKey = `${lastMove.from[0]},${lastMove.from[1]}-${lastMove.to[0]},${lastMove.to[1]}-${lastMove.piece}`;
		if (moveKey === prevMoveKeyRef.current) return;
		prevMoveKeyRef.current = moveKey;

		const totalCaptured =
			(capturedWhite?.length ?? 0) + (capturedBlack?.length ?? 0);
		const wasCapture = totalCaptured > prevCapturedRef.current;
		prevCapturedRef.current = totalCaptured;

		const isCastle =
			lastMove.piece.toLowerCase() === "k" &&
			Math.abs(lastMove.to[1] - lastMove.from[1]) === 2;
		const isPromotion =
			lastMove.piece.toLowerCase() === "p" &&
			(lastMove.to[0] === 0 || lastMove.to[0] === 7);

		if (isPromotion)     soundService.promote();
		else if (isCastle)   soundService.castle();
		else if (wasCapture) soundService.capture();
		else soundService.move();
	}, [lastMove]); // eslint-disable-line react-hooks/exhaustive-deps

	// Check sound — only on transition to in-check
	useEffect(() => {
		if (inCheck && !prevInCheckRef.current && status === "active") {
			soundService.check();
		}
		prevInCheckRef.current = !!inCheck;
	}, [inCheck, status]);

	// Game start / end sounds
	useEffect(() => {
		const prev = prevStatusRef.current;
		if (prev === "waiting" && status === "active") {
			soundService.gameStart();
		}
		if (prev === "active" && status === "finished") {
			const winner = useGameStore.getState().winner;
			setTimeout(() => {
				if (winner === "draw") soundService.draw();
				else soundService.gameEnd();
			}, 300);
		}
		prevStatusRef.current = status;
	}, [status]);
};
