import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Chess } from "chess.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OfflineBotGame from "./OfflineBotGame";

const evaluate = vi.hoisted(() => vi.fn());
const saveGame = vi.hoisted(() => vi.fn());
vi.mock("../hooks/useStockfishEvaluation", () => ({ useStockfishEvaluation: evaluate }));
vi.mock("../utils/offlineStorage", () => ({ saveOfflineGame: saveGame }));
vi.mock("../services/soundService", () => ({
  soundService: { move: vi.fn(), capture: vi.fn(), check: vi.fn(), gameEnd: vi.fn() },
}));

beforeEach(() => {
  evaluate.mockReset().mockReturnValue({ status: "ready", evaluation: null, variations: [] });
  saveGame.mockReset().mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const mount = () => render(<MemoryRouter><OfflineBotGame /></MemoryRouter>);

describe("offline bot play", () => {
  it("plays a human move and applies only the matching finished local-engine result without API calls", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    const view = mount();
    fireEvent.click(screen.getByRole("gridcell", { name: /White Pawn on e2/i }));
    fireEvent.click(screen.getByRole("gridcell", { name: /e4, empty, legal destination/i }));
    expect(screen.getByRole("status")).toHaveTextContent(/Stockfish is thinking/i);
    const position = new Chess();
    position.move("e4");
    expect(evaluate).toHaveBeenLastCalledWith(position.fen(), expect.objectContaining({ depth: 8 }));
    evaluate.mockReturnValue({
      status: "ready",
      evaluation: { fen: position.fen(), final: true, bestMove: "e7e5" },
      variations: [],
    });
    await act(async () => { view.rerender(<MemoryRouter><OfflineBotGame /></MemoryRouter>); });
    expect(screen.getByRole("gridcell", { name: /Black Pawn on e5/i })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/Stockfish played e5/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects stale engine responses after restarting and supports keyboard selection", () => {
    const view = mount();
    fireEvent.click(screen.getByRole("gridcell", { name: /White Pawn on e2/i }));
    fireEvent.click(screen.getByRole("gridcell", { name: /e4, empty, legal destination/i }));
    const oldPosition = new Chess();
    oldPosition.move("e4");
    fireEvent.click(screen.getByRole("button", { name: "New game" }));
    evaluate.mockReturnValue({
      status: "ready",
      evaluation: { fen: oldPosition.fen(), final: true, bestMove: "e7e5" },
      variations: [],
    });
    view.rerender(<MemoryRouter><OfflineBotGame /></MemoryRouter>);
    const e2 = screen.getByRole("gridcell", { name: /White Pawn on e2/i });
    e2.focus();
    fireEvent.keyDown(e2, { key: "ArrowUp" });
    expect(screen.getByRole("gridcell", { name: /e3, empty/i })).toHaveFocus();
    expect(screen.getByRole("gridcell", { name: /Black Pawn on e7/i })).toBeInTheDocument();
  });

  it("provides recovery when the local engine is unsupported or fails", () => {
    evaluate.mockReturnValue({ status: "error", evaluation: null, variations: [] });
    mount();
    expect(screen.getByRole("alert")).toHaveTextContent(/engine could not load/i);
    expect(screen.getByRole("link", { name: "Saved replays" })).toHaveAttribute("href", "/offline-games");
  });

  it("saves local moves to the existing replay store and surfaces storage errors", async () => {
    mount();
    fireEvent.click(screen.getByRole("gridcell", { name: /White Pawn on e2/i }));
    fireEvent.click(screen.getByRole("gridcell", { name: /e4, empty, legal destination/i }));
    saveGame.mockRejectedValue(new Error("Storage unavailable"));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save replay" })); });
    expect(saveGame).toHaveBeenCalledWith(expect.objectContaining({
      whitePlayer: "You", blackPlayer: "Stockfish", result: "*", pgn: expect.stringContaining("e4"),
    }));
    expect(screen.getByRole("alert")).toHaveTextContent("Storage unavailable");
  });
});
