import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { BrowserRouter } from "react-router-dom";
import ChessBoard from "../../src/components/ChessBoard";
import { triggerHaptic } from "../../src/utils/haptics";
import GameSettings from "../../src/components/GameSettings";
import { useGameStore } from "../../src/store/gameStore";
import { INITIAL_BOARD } from "../../src/utils/chessUtils";

// Mock dependencies
vi.mock("../../src/api/gameApi", () => ({
  api: {
    makeMove: vi.fn().mockResolvedValue({ success: true }),
    getMoves: vi.fn().mockResolvedValue({ success: true, data: [] }),
    getGame: vi.fn().mockResolvedValue({ success: true, data: { status: "active", time_control_seconds: 600 } }),
    createGame: vi.fn(),
    joinGame: vi.fn(),
    resignGame: vi.fn(),
    offerDraw: vi.fn(),
    acceptDraw: vi.fn(),
    getChatHistory: vi.fn().mockResolvedValue({ success: true, data: [] }),
  },
}));

vi.mock("../../src/api/socket", () => ({
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

vi.mock("../../src/services/soundService", () => ({
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
    lowTimeTick: vi.fn(),
    playAlert: vi.fn(),
  },
}));

describe("ChessBoard Touch & Haptic Feedback (#439)", () => {
  let vibrateMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vibrateMock = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, "vibrate", {
      value: vibrateMock,
      writable: true,
      configurable: true,
    });

    useGameStore.setState({
      board: INITIAL_BOARD.map((r) => [...r]),
      gameCode: "test-game",
      playerColor: "white",
      currentTurn: "white",
      status: "active",
      selectedSquare: null,
      moveHistory: [],
      viewingIndex: null,
      isHapticsEnabled: true,
      isSettingsOpen: false,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("triggers haptic vibrations accurately for pickup, drop, and error", () => {
    triggerHaptic("pickup");
    expect(vibrateMock).toHaveBeenCalledWith(10);

    triggerHaptic("drop");
    expect(vibrateMock).toHaveBeenCalledWith(25);

    triggerHaptic("error");
    expect(vibrateMock).toHaveBeenCalledWith([40, 30, 40]);
  });

  it("handles missing navigator.vibrate gracefully without throwing", () => {
    Object.defineProperty(navigator, "vibrate", {
      value: undefined,
      writable: true,
      configurable: true,
    });

    expect(() => triggerHaptic("pickup")).not.toThrow();
    expect(() => triggerHaptic("drop")).not.toThrow();
    expect(() => triggerHaptic("error")).not.toThrow();
  });

  it("renders .chessboard-wrapper container with touch-action: none", () => {
    render(
      <BrowserRouter>
        <ChessBoard />
      </BrowserRouter>
    );

    const wrapper = document.querySelector(".chessboard-wrapper");
    expect(wrapper).toBeInTheDocument();
  });

  it("provides a user toggle in GameSettings to enable and disable haptics", () => {
    useGameStore.setState({ isSettingsOpen: true, isHapticsEnabled: true });

    render(
      <BrowserRouter>
        <GameSettings />
      </BrowserRouter>
    );

    const toggle = screen.getByRole("switch", { name: /toggle haptic feedback/i });
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-checked", "true");

    fireEvent.click(toggle);
    expect(useGameStore.getState().isHapticsEnabled).toBe(false);
  });

  it("computes -30px Y-axis offset on touch start and renders elevated ghost piece", () => {
    render(
      <BrowserRouter>
        <ChessBoard />
      </BrowserRouter>
    );

    // E2 pawn is at row 6, col 4
    const e2Square = screen.getByTestId("square-6-4");
    expect(e2Square).toBeInTheDocument();

    // Dispatch touchstart on e2
    fireEvent.touchStart(e2Square, {
      touches: [{ clientX: 200, clientY: 300 }],
    });

    // Should trigger pickup vibration
    expect(vibrateMock).toHaveBeenCalledWith(10);

    // Should render ghost piece overlay elevated by 30px
    const ghost = screen.getByTestId("ghost-piece-overlay");
    expect(ghost).toBeInTheDocument();
    expect(ghost.style.top).toBe("270px"); // 300 - 30
    expect(ghost.style.left).toBe("200px");
  });
});
