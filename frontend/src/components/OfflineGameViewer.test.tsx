import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import OfflineGameViewer from "./OfflineGameViewer";
import * as storage from "../utils/offlineStorage";

vi.mock("../utils/offlineStorage", async (importOriginal) => ({
  ...(await importOriginal<typeof storage>()),
  getAllOfflineGames: vi.fn(),
  exportOfflineGamesToJSON: vi.fn(),
  exportOfflineGamesToPGN: vi.fn(),
  importOfflineGames: vi.fn(),
  MAX_IMPORT_BYTES: 10 * 1024 * 1024,
}));
const game = {
  id: "one",
  createdAt: "2026-11-19T00:00:00.000Z",
  whitePlayer: "Alice",
  blackPlayer: "Bob",
  result: "*" as const,
  pgn: "1. e4 e5 *",
};
function mount() {
  render(
    <MemoryRouter>
      <OfflineGameViewer />
    </MemoryRouter>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(storage.getAllOfflineGames).mockResolvedValue([game]);
  vi.mocked(storage.exportOfflineGamesToPGN).mockResolvedValue(game.pgn);
});
describe("offline replay controls", () => {
  it("downloads selected games through a Blob and cleans up its URL", async () => {
    const create = vi.fn(() => "blob:replay");
    const revoke = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    mount();
    await screen.findByText("Alice vs Bob");
    fireEvent.click(screen.getByRole("checkbox"));
    vi.useFakeTimers();
    try {
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Export PGN" }));
      });
      expect(screen.getByText("Exported 1 games as PGN.")).toBeInTheDocument();
      expect(storage.exportOfflineGamesToPGN).toHaveBeenCalledWith(["one"]);
      expect(create).toHaveBeenCalledWith(expect.any(Blob));
      expect(click).toHaveBeenCalledOnce();
      expect(revoke).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(revoke).toHaveBeenCalledWith("blob:replay");
    } finally {
      vi.useRealTimers();
      click.mockRestore();
    }
  });
  it("imports files, refreshes the list and reports duplicates", async () => {
    vi.mocked(storage.importOfflineGames).mockResolvedValue({ imported: 1, skipped: 2 });
    mount();
    await screen.findByText("Alice vs Bob");
    const file = new File(["{}"], "backup.json");
    Object.defineProperty(file, "text", { value: async () => "{}" });
    fireEvent.change(screen.getByLabelText("Import game file"), { target: { files: [file] } });
    await screen.findByText("Imported 1 games. Skipped 2 duplicates.");
    expect(storage.getAllOfflineGames).toHaveBeenCalledTimes(2);
  });
  it("shows import errors without replacing saved games", async () => {
    vi.mocked(storage.importOfflineGames).mockRejectedValue(new Error("Invalid replay"));
    mount();
    await screen.findByText("Alice vs Bob");
    const file = new File(["bad"], "bad.pgn");
    Object.defineProperty(file, "text", { value: async () => "bad" });
    fireEvent.change(screen.getByLabelText("Import game file"), { target: { files: [file] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid replay");
    expect(screen.getByText("Alice vs Bob")).toBeInTheDocument();
  });
  it("opens a replay and steps through its moves", async () => {
    mount();
    fireEvent.click(await screen.findByText("Alice vs Bob"));
    fireEvent.click(screen.getByRole("button", { name: "Next move" }));
    expect(screen.getByRole("img")).toHaveAccessibleName("Chess position after 1 moves");
    expect(screen.getByText("e4")).toBeInTheDocument();
  });
});
