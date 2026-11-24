import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PuzzlePage from "./PuzzlePage";
import { puzzleApi, type Puzzle } from "../api/puzzleApi";
import { useGameStore } from "../store/gameStore";
import { soundService } from "../services/soundService";
vi.mock("../api/puzzleApi", () => ({ puzzleApi: { fetchAdaptivePuzzle: vi.fn() } }));
const puzzle: Puzzle = {
  id: "one",
  fen: "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3",
  sideToMove: "white",
  rating: 1500,
  themes: [],
  solution: [{ from: [7, 5], to: [4, 2] }],
};
async function mount() {
  render(
    <MemoryRouter>
      <PuzzlePage />
    </MemoryRouter>
  );
  await screen.findByText("Adaptive Tactics");
}
function move(to: [number, number] = [4, 2]) {
  fireEvent.click(screen.getByTestId("puzzle-square-7-5"));
  fireEvent.click(screen.getByTestId(`puzzle-square-${to[0]}-${to[1]}`));
}
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useGameStore.setState({
    puzzleRating: 1500,
    puzzleRD: 350,
    puzzleVolatility: 0.06,
    ratedPuzzleIds: [],
  });
  vi.mocked(puzzleApi.fetchAdaptivePuzzle).mockResolvedValue(puzzle);
  vi.spyOn(soundService, "brilliant").mockImplementation(() => {});
  vi.spyOn(soundService, "playAlert").mockImplementation(() => {});
});
describe("adaptive puzzle training", () => {
  it("requests the persisted rating and uses the new rating for the next puzzle", async () => {
    useGameStore.setState({ puzzleRating: 1600 });
    await mount();
    expect(puzzleApi.fetchAdaptivePuzzle).toHaveBeenCalledWith(
      1600,
      undefined,
      expect.any(AbortSignal)
    );
    move();
    expect(useGameStore.getState().puzzleRating).toBeGreaterThan(1600);
    expect(screen.getByText(/\+\d+ Rating/)).toBeInTheDocument();
    expect(soundService.brilliant).toHaveBeenCalledOnce();
    const rating = useGameStore.getState().puzzleRating;
    vi.mocked(puzzleApi.fetchAdaptivePuzzle).mockResolvedValue({ ...puzzle, id: "two" });
    fireEvent.click(screen.getByRole("button", { name: "Next puzzle" }));
    await waitFor(() =>
      expect(puzzleApi.fetchAdaptivePuzzle).toHaveBeenLastCalledWith(
        rating,
        "one",
        expect.any(AbortSignal)
      )
    );
    await screen.findByText("Adaptive Tactics");
    expect(screen.queryByText(/\+\d+ Rating/)).not.toBeInTheDocument();
  });
  it("penalizes hints once and never rewards solving or resetting the assisted puzzle", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Hint" }));
    const rating = useGameStore.getState().puzzleRating;
    expect(rating).toBeLessThan(1500);
    expect(screen.getByText(/-\d+ Rating/)).toBeInTheDocument();
    move();
    expect(useGameStore.getState().puzzleRating).toBe(rating);
    fireEvent.click(screen.getByTitle("Reset puzzle to starting position"));
    move();
    expect(useGameStore.getState().puzzleRating).toBe(rating);
    expect(soundService.playAlert).toHaveBeenCalledOnce();
    expect(soundService.brilliant).not.toHaveBeenCalled();
  });
  it("records a wrong move once and cancels the retry timer on reset", async () => {
    await mount();
    move([5, 4]);
    const rating = useGameStore.getState().puzzleRating;
    expect(rating).toBeLessThan(1500);
    fireEvent.click(screen.getByTitle("Reset puzzle to starting position"));
    move();
    expect(useGameStore.getState().puzzleRating).toBe(rating);
  });
  it("blocks extra moves while the opponent reply is pending", async () => {
    vi.mocked(puzzleApi.fetchAdaptivePuzzle).mockResolvedValue({
      ...puzzle,
      solution: [puzzle.solution[0], { from: [0, 6], to: [2, 5] }, { from: [7, 4], to: [7, 5] }],
    });
    await mount();
    move();
    move([5, 4]);
    expect(useGameStore.getState().puzzleRating).toBe(1500);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    expect(screen.getByText("2 / 3 moves")).toBeInTheDocument();
  });
  it("shows fetch errors and allows retrying without changing ratings", async () => {
    vi.mocked(puzzleApi.fetchAdaptivePuzzle).mockRejectedValueOnce(
      new Error("No puzzles in range")
    );
    render(
      <MemoryRouter>
        <PuzzlePage />
      </MemoryRouter>
    );
    await screen.findByText("No puzzles in range");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("Adaptive Tactics");
    expect(useGameStore.getState().puzzleRating).toBe(1500);
  });
});
