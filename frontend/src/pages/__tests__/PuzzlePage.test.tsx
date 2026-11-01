import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import PuzzlePage from "../PuzzlePage";
import { PUZZLE_STREAK_STORAGE_KEY } from "../../hooks/usePuzzleStreak";
import { MemoryRouter } from "react-router-dom";

// Mock puzzleApi
const mockPuzzle = {
  id: "daily-123",
  fen: "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3",
  rating: 1500,
  themes: ["opening", "fork"],
  sideToMove: "white" as const,
  solution: [
    { from: [7, 5] as [number, number], to: [4, 2] as [number, number] }, // Bc4
  ],
};

vi.mock("../../api/puzzleApi", () => ({
  puzzleApi: {
    fetchDailyPuzzle: vi.fn(() => Promise.resolve(mockPuzzle)),
  },
}));

describe("PuzzlePage Streak UI Integration", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("renders daily streak badge and weekly calendar", async () => {
    render(
      <MemoryRouter>
        <PuzzlePage />
      </MemoryRouter>
    );

    // Wait for puzzle to load
    await waitFor(() => {
      expect(screen.getByText(/Daily Tactics/i)).toBeInTheDocument();
    });

    // Verify streak badge is displayed with 0 days initially
    expect(screen.getByText(/0 Days/i)).toBeInTheDocument();
    expect(screen.getByText(/\(Best: 0\)/i)).toBeInTheDocument();

    // Verify weekly calendar days Mo through Su are rendered
    expect(screen.getByText("Mo")).toBeInTheDocument();
    expect(screen.getByText("Tu")).toBeInTheDocument();
    expect(screen.getByText("We")).toBeInTheDocument();
    expect(screen.getByText("Th")).toBeInTheDocument();
    expect(screen.getByText("Fr")).toBeInTheDocument();
    expect(screen.getByText("Sa")).toBeInTheDocument();
    expect(screen.getByText("Su")).toBeInTheDocument();
  });

  it("updates streak and shows congratulatory banner upon solving puzzle", async () => {
    render(
      <MemoryRouter>
        <PuzzlePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Daily Tactics/i)).toBeInTheDocument();
    });

    // Find and click the solution square to execute move
    // mockPuzzle solution is [7, 5] (f1) to [4, 2] (c4)
    const fromSquare = screen.getByTestId("puzzle-square-7-5");
    const toSquare = screen.getByTestId("puzzle-square-4-2");

    expect(fromSquare).toBeInTheDocument();
    expect(toSquare).toBeInTheDocument();

    fireEvent.click(fromSquare);
    fireEvent.click(toSquare);

    await waitFor(() => {
      expect(screen.getByText("✓ Puzzle solved!")).toBeInTheDocument();
    });

    // Check that streak badge is updated in UI
    expect(screen.getByTitle("Current Streak: 1 days | Longest: 1 days")).toBeInTheDocument();

    // Check that congratulatory banner is displayed for new personal best
    expect(
      screen.getByText(/New Personal Best Streak: 1 day!/i)
    ).toBeInTheDocument();

    // Dismiss banner
    const dismissBtn = screen.getByLabelText(/Dismiss new record notification/i);
    fireEvent.click(dismissBtn);

    expect(
      screen.queryByText(/New Personal Best Streak: 1 day!/i)
    ).not.toBeInTheDocument();

    // Check localStorage persistence
    const saved = JSON.parse(localStorage.getItem(PUZZLE_STREAK_STORAGE_KEY)!);
    expect(saved.currentStreak).toBe(1);
    expect(saved.longestStreak).toBe(1);
  });
});
