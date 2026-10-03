import { io, Socket } from "socket.io-client";
import type { GameState } from "../types/game";

export interface ChatMessage {
	id: string;
	playerColor: "white" | "black";
	message: string;
	createdAt: string;
}

export interface SpectatorReaction {
	id: string;
	emoji: string;
	xOffset: number;
}

/** Payload of the server's presence/reconnection events (#317). */
export interface OpponentStatusEvent {
	gameCode?: string;
	gameId?: string;
	color: "white" | "black";
	status?: string;
	forfeited?: boolean;
}

const BACKEND_URL =
	import.meta.env.VITE_BACKEND_URL || "http://localhost:3000/";

class SocketService {
	private socket: Socket | null = null;

	connect() {
		if (!this.socket) {
			this.socket = io(BACKEND_URL);
		}
		return this.socket;
	}

	disconnect() {
		if (this.socket) {
			this.socket.disconnect();
			this.socket = null;
		}
	}

	joinGame(gameCode: string) {
		this.socket?.emit("join-game", gameCode);
	}

	leaveGame(gameCode: string) {
		this.socket?.emit("leave-game", gameCode);
	}

	onGameUpdate(callback: (data: GameState) => void) {
		this.socket?.off("game-update");
		this.socket?.on("game-update", callback);
	}

	offGameUpdate() {
		this.socket?.off("game-update");
	}

	onTimerTick(callback: (data: { secondsLeft: number }) => void) {
		this.socket?.on("timer-tick", callback);
	}

	offTimerTick() {
		this.socket?.off("timer-tick");
	}

	sendChatMessage(gameCode: string, playerColor: string, message: string) {
		this.socket?.emit("send-chat", { gameCode, playerColor, message });
	}

	onChatMessage(callback: (data: ChatMessage) => void) {
		this.socket?.off("chat-message");
		this.socket?.on("chat-message", callback);
	}

	sendReaction(gameCode: string, emoji: string) {
		this.socket?.emit("spectator:reaction", { gameCode, emoji });
	}

	onReaction(callback: (data: SpectatorReaction) => void) {
		this.socket?.off("spectator:reaction");
		this.socket?.on("spectator:reaction", callback);
	}

	offReaction() {
		this.socket?.off("spectator:reaction");
	}

	offChatMessage() {
		this.socket?.off("chat-message");
	}

	onTournamentMatchCompleted(callback: (data: any) => void) {
		this.socket?.on("tournament:match_completed", callback);
	}

	offTournamentMatchCompleted() {
		this.socket?.off("tournament:match_completed");
	requestRematch(gameCode: string, playerColor: string) {
		this.socket?.emit("request-rematch", { gameCode, playerColor });
	}

	onRematchRequested(
		callback: (data: { gameCode: string; playerColor: string }) => void,
	) {
		this.socket?.off("rematch-requested");
		this.socket?.on("rematch-requested", callback);
	}

	offRematchRequested() {
		this.socket?.off("rematch-requested");
	}

	// ── Opponent presence (#317) ───────────────────────────────────────────
	// The server broadcasts "presence-update" when a player's socket drops
	// (status "reconnecting") and again after the 60 s grace period expires
	// with the match auto-forfeited (status "offline", forfeited true).
	onOpponentReconnecting(callback: (data: OpponentStatusEvent) => void) {
		this.socket?.off("presence-update");
		this.socket?.on("presence-update", callback);
	}

	offOpponentReconnecting() {
		this.socket?.off("presence-update");
	}

	// The reconnecting player's client cancels the grace timer through the
	// join-game or reconnect_game handlers, which emit the same event under
	// two spellings; both are wired so the banner dismisses either way.
	onOpponentReconnected(callback: (data: OpponentStatusEvent) => void) {
		this.socket?.off("player_reconnected");
		this.socket?.off("player-reconnected");
		this.socket?.on("player_reconnected", callback);
		this.socket?.on("player-reconnected", callback);
	}

	offOpponentReconnected() {
		this.socket?.off("player_reconnected");
		this.socket?.off("player-reconnected");
	}
}

export const socketService = new SocketService();
