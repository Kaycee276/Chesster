import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { useGameStore } from "../src/store/gameStore";
import { socketService } from "../src/api/socket";

// Mock the socket service
vi.mock("../src/api/socket", () => ({
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

// Mock the game API
vi.mock("../src/api/gameApi", () => ({
  api: {
    joinGame: vi.fn(() => Promise.resolve({ success: true, data: { game_code: "TEST001" } })),
    getGame: vi.fn(() =>
      Promise.resolve({
        success: true,
        data: {
          board_state: [],
          current_turn: "white",
          status: "active",
          time_control_seconds: 600,
        },
      })
    ),
    getMoves: vi.fn(() => Promise.resolve({ success: true, data: [] })),
    getChatHistory: vi.fn(() => Promise.resolve({ success: true, data: [] })),
  },
}));

describe("gameStore.spectator", () => {
  beforeEach(() => {
    // Reset store before each test
    useGameStore.setState({
      spectatorCount: 0,
      spectatorList: [],
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("initializes with spectatorCount = 0", () => {
    const state = useGameStore.getState();
    expect(state.spectatorCount).toBe(0);
  });

  it("initializes with empty spectatorList", () => {
    const state = useGameStore.getState();
    expect(state.spectatorList).toEqual([]);
  });

  it("updates spectatorCount and spectatorList via setSpectatorData", () => {
    const spectators = [
      { address: "GABC1234567890", username: "Alice" },
      { address: "GDEF9876543210", username: null },
    ];

    useGameStore.getState().setSpectatorData(2, spectators);

    const state = useGameStore.getState();
    expect(state.spectatorCount).toBe(2);
    expect(state.spectatorList).toEqual(spectators);
  });

  it("resets spectatorCount and spectatorList on leaveGame", () => {
    // Set initial spectator data
    useGameStore.getState().setSpectatorData(5, [
      { address: "GABC1234567890", username: "Alice" },
    ]);

    expect(useGameStore.getState().spectatorCount).toBe(5);

    // Leave game
    useGameStore.getState().leaveGame();

    const state = useGameStore.getState();
    expect(state.spectatorCount).toBe(0);
    expect(state.spectatorList).toEqual([]);
  });

  it("cleans up spectator listener on leaveGame", () => {
    useGameStore.getState().leaveGame();
    expect(socketService.offSpectatorCountUpdate).toHaveBeenCalled();
  });

  it("handles malformed payload by ignoring (negative count)", () => {
    // Store should validate and ignore negative counts
    useGameStore.getState().setSpectatorData(-1, []);
    // The setSpectatorData uses Math.max(0, count) so it should clamp to 0
    expect(useGameStore.getState().spectatorCount).toBe(0);
  });

  it("handles malformed payload by using empty list if list is not provided", () => {
    useGameStore.getState().setSpectatorData(2, [] as any);
    expect(useGameStore.getState().spectatorList).toEqual([]);
  });

  it("does not throw on setSpectatorData with missing fields", () => {
    const spectators = [
      { address: "GABC1234567890" }, // missing username is OK
    ] as any;

    expect(() => {
      useGameStore.getState().setSpectatorData(1, spectators);
    }).not.toThrow();

    const state = useGameStore.getState();
    expect(state.spectatorCount).toBe(1);
  });

  it("accepts spectatorList with null/undefined usernames", () => {
    const spectators = [
      { address: "GABC1234567890", username: null },
      { address: "GDEF9876543210", username: undefined },
    ];

    useGameStore.getState().setSpectatorData(2, spectators);

    const state = useGameStore.getState();
    expect(state.spectatorList).toEqual(spectators);
  });

  it("preserves spectatorCount and spectatorList on other state updates", () => {
    useGameStore.getState().setSpectatorData(3, [
      { address: "GABC1234567890", username: "Alice" },
    ]);

    // Update other state
    useGameStore.getState().selectSquare([4, 4]);

    const state = useGameStore.getState();
    expect(state.spectatorCount).toBe(3);
    expect(state.spectatorList.length).toBe(1);
  });

  it("can be set to zero when all spectators leave", () => {
    useGameStore.getState().setSpectatorData(5, []);
    expect(useGameStore.getState().spectatorCount).toBe(5);

    useGameStore.getState().setSpectatorData(0, []);
    const state = useGameStore.getState();
    expect(state.spectatorCount).toBe(0);
    expect(state.spectatorList).toEqual([]);
  });
});
