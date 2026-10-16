import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BrowserRouter } from "react-router-dom";
import { useGameStore } from "../../src/store/gameStore";

// Mock dependencies
vi.mock("../../src/api/gameApi", () => ({
  api: {
    getGame: vi.fn(() =>
      Promise.resolve({
        success: true,
        data: {
          board_state: Array(8).fill(Array(8).fill(".")),
          current_turn: "white",
          status: "waiting",
          in_check: false,
          winner: null,
          end_reason: null,
          draw_offer: null,
          captured_white: [],
          captured_black: [],
          time_control_seconds: 600,
          wager_amount: null,
          token_address: null,
          escrow_status: null,
        },
      })
    ),
    joinGame: vi.fn(() =>
      Promise.resolve({ success: true, data: { game_code: "TEST001" } })
    ),
    getMoves: vi.fn(() => Promise.resolve({ success: true, data: [] })),
    getChatHistory: vi.fn(() => Promise.resolve({ success: true, data: [] })),
  },
}));

vi.mock("../../src/api/socket", () => ({
  socketService: {
    connect: vi.fn(),
    joinGame: vi.fn(),
    onGameUpdate: vi.fn(),
    onChatMessage: vi.fn(),
    onSpectatorCountUpdate: vi.fn(),
    offGameUpdate: vi.fn(),
    offChatMessage: vi.fn(),
    offSpectatorCountUpdate: vi.fn(),
    leaveGame: vi.fn(),
    disconnect: vi.fn(),
  },
}));

vi.mock("../../src/store/walletStore", () => ({
  useWalletStore: vi.fn(() => ({
    address: "GABC1234567890",
    isConnected: true,
    connect: vi.fn(),
  })),
}));

vi.mock("../../src/store/toastStore", () => ({
  useToastStore: vi.fn(() => ({
    addToast: vi.fn(),
  })),
}));

vi.mock("../../src/hooks/useGraceCountdown", () => ({
  useGraceCountdown: vi.fn(() => 60),
}));

describe("GamePage - Spectator Badge", () => {
  beforeEach(() => {
    useGameStore.setState({
      spectatorCount: 0,
      spectatorList: [],
    });
  });

  // Note: Full integration tests for the badge require the entire ChessBoard
  // component to be mounted, which is tested at a component level.
  // These unit tests focus on state management.

  it("badge displays zero when no spectators", () => {
    const state = useGameStore.getState();
    expect(state.spectatorCount).toBe(0);
  });

  it("badge count updates when spectators join", () => {
    useGameStore.getState().setSpectatorData(1, []);
    expect(useGameStore.getState().spectatorCount).toBe(1);

    useGameStore.getState().setSpectatorData(3, [
      { address: "GABC1", username: "Alice" },
      { address: "GDEF2", username: "Bob" },
      { address: "GXYZ3", username: null },
    ]);
    expect(useGameStore.getState().spectatorCount).toBe(3);
  });

  it("badge updates when spectators leave", () => {
    useGameStore.getState().setSpectatorData(5, []);
    expect(useGameStore.getState().spectatorCount).toBe(5);

    useGameStore.getState().setSpectatorData(3, []);
    expect(useGameStore.getState().spectatorCount).toBe(3);

    useGameStore.getState().setSpectatorData(0, []);
    expect(useGameStore.getState().spectatorCount).toBe(0);
  });

  it("spectator list is cleared when count goes to zero", () => {
    useGameStore.getState().setSpectatorData(2, [
      { address: "GABC1", username: "Alice" },
      { address: "GDEF2", username: "Bob" },
    ]);
    expect(useGameStore.getState().spectatorList.length).toBe(2);

    useGameStore.getState().setSpectatorData(0, []);
    expect(useGameStore.getState().spectatorList).toEqual([]);
  });

  it("spectator data is reset when leaving game", () => {
    useGameStore.getState().setSpectatorData(5, [
      { address: "GABC1", username: "Alice" },
    ]);
    expect(useGameStore.getState().spectatorCount).toBe(5);

    useGameStore.getState().leaveGame();

    const state = useGameStore.getState();
    expect(state.spectatorCount).toBe(0);
    expect(state.spectatorList).toEqual([]);
  });

  it("spectator list persists across store updates", () => {
    const spectators = [
      { address: "GABC1", username: "Alice" },
      { address: "GDEF2", username: "Bob" },
    ];
    useGameStore.getState().setSpectatorData(2, spectators);

    // Update another part of state
    useGameStore.getState().selectSquare([3, 3]);

    const state = useGameStore.getState();
    expect(state.spectatorCount).toBe(2);
    expect(state.spectatorList).toEqual(spectators);
  });

  it("handles rapid spectator changes", () => {
    // Simulate spectators joining and leaving rapidly
    for (let i = 0; i < 10; i++) {
      useGameStore.getState().setSpectatorData(i, []);
    }

    expect(useGameStore.getState().spectatorCount).toBe(9);

    for (let i = 9; i >= 0; i--) {
      useGameStore.getState().setSpectatorData(i, []);
    }

    expect(useGameStore.getState().spectatorCount).toBe(0);
  });

  it("maintains spectator list order", () => {
    const spectators = [
      { address: "ADDR1", username: "Alice" },
      { address: "ADDR2", username: "Bob" },
      { address: "ADDR3", username: "Charlie" },
    ];

    useGameStore.getState().setSpectatorData(3, spectators);

    const state = useGameStore.getState();
    expect(state.spectatorList[0].username).toBe("Alice");
    expect(state.spectatorList[1].username).toBe("Bob");
    expect(state.spectatorList[2].username).toBe("Charlie");
  });
});
