import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import GameLobby from "../../src/components/GameLobby";
import { useWalletStore } from "../../src/store/walletStore";
import { useGameStore } from "../../src/store/gameStore";

vi.mock("qrcode", () => ({
  default: {
    toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,mockqr"),
  },
}));

vi.mock("../../src/services/stellarService", () => ({
  depositXLM: vi.fn().mockResolvedValue("mock-tx-hash"),
  fetchAccountBalances: vi.fn().mockResolvedValue([{ assetCode: "XLM", balance: "100" }]),
}));

const renderGameLobby = () => {
  return render(
    <MemoryRouter>
      <GameLobby />
    </MemoryRouter>
  );
};

describe("GameLobby Component Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWalletStore.setState({
      isConnected: false,
      address: null,
      walletType: null,
      networkPassphrase: null,
    });
    useGameStore.setState({
      gameCode: null,
      playerColor: null,
    });
  });

  test("disables create game button when wallet is disconnected", () => {
    renderGameLobby();
    const createButton = screen.getByRole("button", { name: /create/i });
    expect(createButton).toBeDisabled();
    expect(screen.getByRole("button", { name: /freighter/i })).toBeInTheDocument();
  });

  test("enables create game button when wallet is connected", () => {
    useWalletStore.setState({
      isConnected: true,
      address: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGAAA5CDU9999999999",
    });
    renderGameLobby();
    const createButton = screen.getByRole("button", { name: /create/i });
    expect(createButton).not.toBeDisabled();
  });

  test("clicking time control preset updates time control state", () => {
    useWalletStore.setState({
      isConnected: true,
      address: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGAAA5CDU9999999999",
    });
    renderGameLobby();
    const fiveMinButton = screen.getAllByRole("button", { name: /5 min/i })[0];
    fireEvent.click(fiveMinButton);
    expect(fiveMinButton.className).toContain("border-(--accent-primary)");
  });

  test("toggling custom time control reveals sliders", () => {
    useWalletStore.setState({
      isConnected: true,
      address: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGAAA5CDU9999999999",
    });
    renderGameLobby();
    const customButton = screen.getByText("Custom");
    fireEvent.click(customButton);
    expect(screen.getByText(/Base time/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Increment/i).length).toBeGreaterThan(0);
  });

  test("toggling wager enables the wager amount input", () => {
    useWalletStore.setState({
      isConnected: true,
      address: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGAAA5CDU9999999999",
    });
    renderGameLobby();

    const wagerToggle = screen.getByText("Play with wager");
    fireEvent.click(wagerToggle);

    expect(screen.getByPlaceholderText("e.g. 10")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create game & wager xlm/i })).toBeInTheDocument();
  });

  test("clicking quick wager preset updates wager input", () => {
    useWalletStore.setState({
      isConnected: true,
      address: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGAAA5CDU9999999999",
    });
    renderGameLobby();

    const wagerToggle = screen.getByText("Play with wager");
    fireEvent.click(wagerToggle);

    const preset25 = screen.getByRole("button", { name: "25 XLM" });
    fireEvent.click(preset25);

    const input = screen.getByPlaceholderText("e.g. 10") as HTMLInputElement;
    expect(input.value).toBe("25");
  });

  test("allows custom numeric and decimal wager input", () => {
    useWalletStore.setState({
      isConnected: true,
      address: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGAAA5CDU9999999999",
    });
    renderGameLobby();

    const wagerToggle = screen.getByText("Play with wager");
    fireEvent.click(wagerToggle);

    const input = screen.getByPlaceholderText("e.g. 10");
    fireEvent.change(input, { target: { value: "10.5" } });
    expect(input).toHaveValue(10.5);
  });

  test("allows typing a game code to join", () => {
    renderGameLobby();
    const joinInput = screen.getByPlaceholderText(/enter game code/i) as HTMLInputElement;
    fireEvent.change(joinInput, { target: { value: "TEST12" } });
    expect(joinInput.value).toBe("TEST12");
  });

  test("disables join game button when game code is empty", () => {
    renderGameLobby();
    const joinButton = screen.getByRole("button", { name: /join game/i });
    expect(joinButton).toBeDisabled();
  });

  test("enables join game button when connected and code is typed", () => {
    useWalletStore.setState({
      isConnected: true,
      address: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGAAA5CDU9999999999",
    });
    renderGameLobby();
    const joinInput = screen.getByPlaceholderText(/enter game code/i);
    fireEvent.change(joinInput, { target: { value: "ABC123" } });
    const joinButton = screen.getByRole("button", { name: /join game/i });
    expect(joinButton).not.toBeDisabled();
  });

  test("calls createGame on store when create game button is clicked without wager", async () => {
    const mockCreateGame = vi.fn().mockResolvedValue(undefined);
    useGameStore.setState({
      createGame: mockCreateGame,
      gameCode: "MOCKCD",
    });
    useWalletStore.setState({
      isConnected: true,
      address: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGAAA5CDU9999999999",
    });

    renderGameLobby();
    const createButton = screen.getByRole("button", { name: /create new game/i });
    fireEvent.click(createButton);

    await waitFor(() => {
      expect(mockCreateGame).toHaveBeenCalledWith(
        "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGAAA5CDU9999999999",
        undefined,
        1800,
        0
      );
    });
  });
});
