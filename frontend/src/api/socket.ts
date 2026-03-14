import { io, Socket } from "socket.io-client";
import type { GameState } from "../types/game";

export interface ChatMessage {
	id: string;
	playerColor: "white" | "black";
	message: string;
	createdAt: string;
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

	offChatMessage() {
		this.socket?.off("chat-message");
	}
}

export const socketService = new SocketService();
