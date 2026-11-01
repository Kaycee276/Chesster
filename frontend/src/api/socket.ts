import { io, Socket } from "socket.io-client";
import type { GameState } from "../types/game";

export interface ChatMessage {
  id: string;
  playerColor: "white" | "black";
  message: string;
  createdAt: string;
}

export interface SpectatorCountEvent {
	count: number;
	list?: Array<{ address: string; username?: string | null }>;
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

export interface MatchReadyEvent {
  gameCode: string;
  round: number | string;
  opponentName: string;
  opponentRating?: number | string;
  color: "white" | "black";
}

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:3000/";

// Latency measurement interval (Issue #401)
const LATENCY_CHECK_INTERVAL = 10000; // 10 seconds

class SocketService {
  private socket: Socket | null = null;
  private latencyInterval: ReturnType<typeof setInterval> | null = null;

  connect() {
    if (!this.socket) {
      this.socket = io(BACKEND_URL);
      this.setupConnectionListeners();
      this.startLatencyMonitoring();
    }
    return this.socket;
  }

  disconnect() {
    this.stopLatencyMonitoring();
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  /**
   * Setup connection status listeners (Issue #401)
   */
  private setupConnectionListeners() {
    if (!this.socket) return;

    this.socket.on("connect", () => {
      // Update store when connected
      import("../store/gameStore").then(({ useGameStore }) => {
        useGameStore.getState().setSocketStatus("connected");
        useGameStore.getState().setReconnectAttempts(0);
      });
    });

    this.socket.on("disconnect", () => {
      // Update store when disconnected
      import("../store/gameStore").then(({ useGameStore }) => {
        useGameStore.getState().setSocketStatus("disconnected");
      });
    });

    this.socket.io.on("reconnect_attempt", (attemptNumber) => {
      // Update store with reconnection attempt count
      import("../store/gameStore").then(({ useGameStore }) => {
        useGameStore.getState().setSocketStatus("reconnecting");
        useGameStore.getState().setReconnectAttempts(attemptNumber);
      });
    });

    this.socket.io.on("reconnect", () => {
      // Successfully reconnected
      import("../store/gameStore").then(({ useGameStore }) => {
        useGameStore.getState().setSocketStatus("connected");
        useGameStore.getState().setReconnectAttempts(0);
      });
    });
  }

  /**
   * Measure round-trip latency (Issue #401)
   */
  measureLatency(onLatency: (ms: number) => void) {
    if (!this.socket) return;

    const start = Date.now();
    this.socket.emit("ping:check", () => {
      const latency = Date.now() - start;
      onLatency(latency);
    });
  }

  /**
   * Start periodic latency monitoring (Issue #401)
   */
  private startLatencyMonitoring() {
    if (this.latencyInterval) return;

    this.latencyInterval = setInterval(() => {
      if (this.socket?.connected) {
        this.measureLatency((ms) => {
          import("../store/gameStore").then(({ useGameStore }) => {
            useGameStore.getState().setPingMs(ms);
          });
        });
      }
    }, LATENCY_CHECK_INTERVAL);
  }

  /**
   * Stop latency monitoring
   */
  private stopLatencyMonitoring() {
    if (this.latencyInterval) {
      clearInterval(this.latencyInterval);
      this.latencyInterval = null;
    }
  }

  /**
   * Get raw socket instance
   */
  getSocket(): Socket | null {
    return this.socket;
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

  onTournamentMatchCompleted(callback: (data: unknown) => void) {
    this.socket?.on("tournament:match_completed", callback);
  }

  offTournamentMatchCompleted() {
    this.socket?.off("tournament:match_completed");
  }

  onTournamentMatchReady(callback: (data: MatchReadyEvent) => void) {
    this.socket?.on("tournament:match_ready", callback);
  }

  offTournamentMatchReady() {
    this.socket?.off("tournament:match_ready");
  }

  requestRematch(gameCode: string, playerColor: string) {
    this.socket?.emit("request-rematch", { gameCode, playerColor });
  }

  onRematchRequested(callback: (data: { gameCode: string; playerColor: string }) => void) {
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

  onSpectatorCountUpdate(callback: (data: SpectatorCountEvent) => void) {
    this.socket?.off("spectator_count_update");
    this.socket?.on("spectator_count_update", callback);
  }

  offSpectatorCountUpdate() {
    this.socket?.off("spectator_count_update");
  }
}

export const socketService = new SocketService();

export function getSocket(): Socket {
  return socketService.connect();
}
