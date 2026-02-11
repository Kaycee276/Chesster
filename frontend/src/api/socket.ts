import { io, Socket } from "socket.io-client";
import type { GameState } from "../types/game";

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
		this.socket?.on("game-update", callback);
	}

	offGameUpdate() {
		this.socket?.off("game-update");
	}
}

export const socketService = new SocketService();
