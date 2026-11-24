import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import ChessBoard from "../src/components/ChessBoard";
import { useGameStore } from "../src/store/gameStore";
import { useThemeStore } from "../src/store/themeStore";

vi.mock("../src/components/ChatPanel", () => ({ default: () => null }));
vi.mock("../src/api/gameApi", () => ({
  api: {
    getMoves: vi.fn().mockResolvedValue({ success: true, data: [] }),
    getGame: vi.fn().mockResolvedValue({ success: true, data: { status: "active" } }),
    getChatHistory: vi.fn().mockResolvedValue({ success: true, data: [] }),
  },
}));
vi.mock("../src/api/socket", () => ({
  socketService: { onRematchRequested: vi.fn(), offRematchRequested: vi.fn() },
}));
vi.mock("../src/services/soundService", () => ({
  soundService: {
    isEnabled: () => false, getVolume: () => 0.8,
    move: vi.fn(), capture: vi.fn(), check: vi.fn(), lowTime: vi.fn(), lowTimeTick: vi.fn(),
  },
}));

beforeEach(() => {
  const board = Array.from({ length: 8 }, () => Array<string>(8).fill("."));
  board[7][4] = "K"; board[0][4] = "k";
  board[6][3] = "P"; board[5][4] = "p";
  useGameStore.setState({
    board, gameCode: "HINT751", status: "active", playerColor: "white",
    currentTurn: "white", selectedSquare: [6, 3], moveHistory: [], viewingIndex: null,
    lastMove: null, inCheck: false, blindfoldMode: "none", isBlindfoldMode: false,
    isStreamerMode: false, wagerAmount: null, winner: null, drawOffer: null,
  });
  useThemeStore.getState().setMoveHighlightColor("emerald");
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("live legal move marker colors", () => {
  it("updates existing dots and capture rings without remounting the board", () => {
    const { container } = render(<BrowserRouter><ChessBoard /></BrowserRouter>);
    const dot = container.querySelector(".legal-move-dot") as HTMLElement;
    const ring = container.querySelector(".legal-move-ring") as HTMLElement;
    expect(dot).not.toBeNull(); expect(ring).not.toBeNull();
    const originalDot = dot.style.backgroundColor;
    const originalRing = ring.style.borderColor;
    act(() => useThemeStore.getState().setMoveHighlightColor("sapphire"));
    expect(dot.style.backgroundColor).not.toBe(originalDot);
    expect(ring.style.borderColor).not.toBe(originalRing);
    act(() => useThemeStore.getState().setMoveHighlightColor("monochrome"));
    expect(dot.style.backgroundColor).toBe("transparent");
    expect(dot.style.borderStyle).toBe("solid");
    expect(ring.style.borderColor).toBe("rgb(255, 255, 255)");
  });

  it("offers the same color choices inside active board settings", () => {
    render(<BrowserRouter><ChessBoard /></BrowserRouter>);
    // Both desktop tab and mobile drawer triggers use this visible product label.
    fireEvent.click(screen.getAllByRole("button", { name: /Settings/ }).at(-1)!);
    const amber = screen.getByRole("button", { name: "Amber Yellow legal move highlights" });
    amber.focus();
    expect(fireEvent.keyDown(amber, { key: " " })).toBe(true);
    expect(document.activeElement).toBe(amber);
    fireEvent.click(amber);
    expect(useThemeStore.getState().moveHighlightColor).toBe("amber");
  });
});
