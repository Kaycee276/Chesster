import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import GamePage from "./GamePage";
import { useGameStore } from "../store/gameStore";
import { useWalletStore } from "../store/walletStore";
import MobileDrawer from "../components/MobileDrawer";

const snapHeights = {
  collapsed: "60px",
  half: "40vh",
  full: "85vh",
};

vi.mock("../api/gameApi", () => ({
  api: {
    getGame: vi.fn().mockResolvedValue({ success: true, data: {} }),
    getMoves: vi.fn().mockResolvedValue({ success: true, data: [] }),
  },
}));

vi.mock("../api/socket", () => ({
  socketService: {
    onOpponentReconnecting: vi.fn(),
    onOpponentReconnected: vi.fn(),
    offOpponentReconnecting: vi.fn(),
    offOpponentReconnected: vi.fn(),
    onChatMessage: vi.fn(),
    offChatMessage: vi.fn(),
    onRematchRequested: vi.fn(),
    offRematchRequested: vi.fn(),
    onRematchAccepted: vi.fn(),
    offRematchAccepted: vi.fn(),
    onOpponentStatus: vi.fn(),
    offOpponentStatus: vi.fn(),
    sendChatMessage: vi.fn(),
  },
}));

describe("GamePage Mobile Bottom Sheet Drawer (#684)", () => {
  beforeEach(() => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    useGameStore.setState({
      gameCode: "test1234",
      playerColor: "white",
      currentTurn: "white",
      status: "active",
      secondsLeft: 60,
      timeControlSeconds: 60,
      board: Array(8).fill(Array(8).fill(".")),
      moveHistory: [],
      rejoinGame: vi.fn(),
    });
    useWalletStore.setState({
      address: "GCXYZ123456",
      isConnected: true,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("opens the keyboard shortcuts modal from the game toolbar and via ? (#750)", async () => {
    render(
      <MemoryRouter initialEntries={["/game/test1234"]}>
        <Routes>
          <Route path="/game/:gameCode" element={<GamePage />} />
        </Routes>
      </MemoryRouter>
    );

    const trigger = await screen.findByLabelText("View keyboard shortcuts (Press ?)");
    fireEvent.click(trigger);
    expect(screen.getByText("Keyboard Shortcuts")).toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByText("Keyboard Shortcuts")).not.toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: "?" });
    expect(screen.getByText("Keyboard Shortcuts")).toBeInTheDocument();
  });

  it("renders MobileDrawer with initial collapsed snap point (60px)", async () => {
    render(
      <MemoryRouter initialEntries={["/game/test1234"]}>
        <Routes>
          <Route path="/game/:gameCode" element={<GamePage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      const drawer = screen.getByTestId("mobile-drawer");
      expect(drawer).toBeInTheDocument();
      expect(drawer.style.height).toBe(snapHeights.collapsed);
      expect(drawer.className).toContain("md:hidden");
    });
  });

  it("expands drawer to half (40vh) on touch swipe up or handle tap", () => {
    render(<MobileDrawer initialSnap="collapsed" />);
    const drawer = screen.getByTestId("mobile-drawer");
    expect(drawer.style.height).toBe(snapHeights.collapsed);

    // Tap handle to cycle snap point
    const handle = screen.getByTestId("drawer-handle");
    fireEvent.click(handle);
    expect(drawer.style.height).toBe(snapHeights.half);

    // Tap again to cycle to full
    fireEvent.click(handle);
    expect(drawer.style.height).toBe(snapHeights.full);

    // Tap again to cycle back to collapsed
    fireEvent.click(handle);
    expect(drawer.style.height).toBe(snapHeights.collapsed);
  });

  it("responds to touch drag gestures (swipe up to expand, swipe down to collapse)", () => {
    render(<MobileDrawer initialSnap="collapsed" />);
    const drawer = screen.getByTestId("mobile-drawer");

    // Swipe up: clientY goes from 500 to 400 (delta = -100)
    fireEvent.touchStart(drawer, {
      touches: [{ clientY: 500 }],
    });
    fireEvent.touchEnd(drawer, {
      changedTouches: [{ clientY: 400 }],
    });
    expect(drawer.style.height).toBe(snapHeights.half);

    // Swipe down: clientY goes from 300 to 450 (delta = +150)
    fireEvent.touchStart(drawer, {
      touches: [{ clientY: 300 }],
    });
    fireEvent.touchEnd(drawer, {
      changedTouches: [{ clientY: 450 }],
    });
    expect(drawer.style.height).toBe(snapHeights.collapsed);
  });

  it("switches tabs between moves, chat, and info", () => {
    render(<MobileDrawer initialSnap="half" />);

    expect(screen.getByTestId("drawer-tab-moves")).toBeInTheDocument();
    expect(screen.getByTestId("drawer-tab-chat")).toBeInTheDocument();
    expect(screen.getByTestId("drawer-tab-info")).toBeInTheDocument();

    // Click chat tab
    fireEvent.click(screen.getByTestId("drawer-tab-chat"));
    expect(screen.getByTestId("drawer-chat-content")).toBeInTheDocument();

    // Click info tab
    fireEvent.click(screen.getByTestId("drawer-tab-info"));
    expect(screen.getByText(/Match Code:/i)).toBeInTheDocument();
  });

  it("renders backdrop scrim when expanded and closes drawer on scrim click", () => {
    render(<MobileDrawer initialSnap="half" />);

    const scrim = screen.getByTestId("drawer-scrim");
    expect(scrim).toBeInTheDocument();

    fireEvent.click(scrim);
    const drawer = screen.getByTestId("mobile-drawer");
    expect(drawer.style.height).toBe(snapHeights.collapsed);
  });
});
