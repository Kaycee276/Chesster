import { render, screen, fireEvent } from "@testing-library/react";
import { describe, test, expect, vi, beforeEach } from "vitest";
import GameLobby from "../../src/components/GameLobby";

// Mock gameStore if needed
vi.mock("../../src/stores/gameStore", () => ({
  default: {
    createGame: vi.fn(),
    timeControlSeconds: 180,
  },
}));

describe("GameLobby Component Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("disables create game button when wager is negative", () => {
    render(<GameLobby />);
    const input = screen.getByPlaceholderText(/wager/i);
    fireEvent.change(input, { target: { value: "-5" } });
    expect(screen.getByRole("button", { name: /create/i })).toBeDisabled();
  });

  test("disables create game button when wager is empty", () => {
    render(<GameLobby />);
    const input = screen.getByPlaceholderText(/wager/i);
    fireEvent.change(input, { target: { value: "" } });
    expect(screen.getByRole("button", { name: /create/i })).toBeDisabled();
  });

  test("shows validation error for negative wager amount", () => {
    render(<GameLobby />);
    const input = screen.getByPlaceholderText(/wager/i);
    fireEvent.change(input, { target: { value: "-10" } });
    fireEvent.blur(input);
    expect(screen.getByText(/wager.*negative|invalid/i)).toBeInTheDocument();
  });

  test("shows validation error for non-numeric wager input", () => {
    render(<GameLobby />);
    const input = screen.getByPlaceholderText(/wager/i);
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.blur(input);
    expect(screen.getByText(/valid.*number|numeric/i)).toBeInTheDocument();
  });

  test("clicking time control preset updates time control state", () => {
    render(<GameLobby />);
    const blitzButton = screen.getByRole("button", { name: /3.*min.*blitz|blitz.*3/i });
    fireEvent.click(blitzButton);
    // Verify selection via UI state (e.g., active class or selected indicator)
    expect(blitzButton).toHaveClass(/active|selected/);
  });

  test("clicking bullet preset (1 min) updates time control", () => {
    render(<GameLobby />);
    const bulletButton = screen.getByRole("button", { name: /1.*min.*bullet|bullet.*1/i });
    fireEvent.click(bulletButton);
    expect(bulletButton).toHaveClass(/active|selected/);
  });

  test("clicking rapid preset (10 min) updates time control", () => {
    render(<GameLobby />);
    const rapidButton = screen.getByRole("button", { name: /10.*min.*rapid|rapid.*10/i });
    fireEvent.click(rapidButton);
    expect(rapidButton).toHaveClass(/active|selected/);
  });

  test("disables create game button when wallet is disconnected", () => {
    // Mock wallet disconnected state
    vi.mock("../../src/hooks/useWallet", () => ({
      default: () => ({ connected: false, publicKey: null }),
    }));
    
    render(<GameLobby />);
    expect(screen.getByRole("button", { name: /create/i })).toBeDisabled();
  });

  test("shows warning when wager exceeds available balance", () => {
    // Mock wallet with low balance
    vi.mock("../../src/hooks/useWallet", () => ({
      default: () => ({ connected: true, balance: 50 }),
    }));
    
    render(<GameLobby />);
    const input = screen.getByPlaceholderText(/wager/i);
    fireEvent.change(input, { target: { value: "100" } });
    fireEvent.blur(input);
    expect(screen.getByText(/insufficient.*balance|exceeds.*balance/i)).toBeInTheDocument();
  });

  test("allows valid wager input and enables create button", () => {
    render(<GameLobby />);
    const input = screen.getByPlaceholderText(/wager/i);
    fireEvent.change(input, { target: { value: "50" } });
    expect(screen.getByRole("button", { name: /create/i })).not.toBeDisabled();
  });

  test("clicking create game calls createGame API with correct parameters", async () => {
    const mockCreateGame = vi.fn();
    vi.mock("../../src/stores/gameStore", () => ({
      default: {
        createGame: mockCreateGame,
      },
    }));

    render(<GameLobby />);
    
    // Set up game parameters
    const wagerInput = screen.getByPlaceholderText(/wager/i);
    fireEvent.change(wagerInput, { target: { value: "100" } });
    
    const blitzButton = screen.getByRole("button", { name: /3.*min.*blitz/i });
    fireEvent.click(blitzButton);
    
    const createButton = screen.getByRole("button", { name: /create/i });
    fireEvent.click(createButton);
    
    expect(mockCreateGame).toHaveBeenCalledWith(
      expect.objectContaining({
        wagerAmount: 100,
        timeControlSeconds: 180,
      })
    );
  });

  test("resets form after successful game creation", async () => {
    render(<GameLobby />);
    
    const wagerInput = screen.getByPlaceholderText(/wager/i);
    fireEvent.change(wagerInput, { target: { value: "50" } });
    
    const createButton = screen.getByRole("button", { name: /create/i });
    fireEvent.click(createButton);
    
    // Wait for async operation
    await screen.findByPlaceholderText(/wager/i);
    
    // Verify form reset
    expect(wagerInput).toHaveValue("");
  });

  test("prevents form submission with zero wager", () => {
    render(<GameLobby />);
    const input = screen.getByPlaceholderText(/wager/i);
    fireEvent.change(input, { target: { value: "0" } });
    expect(screen.getByRole("button", { name: /create/i })).toBeDisabled();
  });

  test("handles decimal wager amounts correctly", () => {
    render(<GameLobby />);
    const input = screen.getByPlaceholderText(/wager/i);
    fireEvent.change(input, { target: { value: "10.5" } });
    expect(input).toHaveValue("10.5");
    expect(screen.getByRole("button", { name: /create/i })).not.toBeDisabled();
  });
});
