import { beforeEach, describe, expect, it } from "vitest";
import { useGameStore } from "./gameStore";
import { DEFAULT_PUZZLE_RATING } from "../utils/glickoCalculator";
beforeEach(() => {
  localStorage.clear();
  useGameStore.setState({
    puzzleRating: 1500,
    puzzleRD: 350,
    puzzleVolatility: 0.06,
    ratedPuzzleIds: [],
  });
});
describe("persisted puzzle ratings", () => {
  it("persists all three Glicko parameters and restores them after hydration", async () => {
    const delta = useGameStore.getState().updatePuzzleRating(1500, true, "one");
    expect(delta).toBeGreaterThan(0);
    const state = useGameStore.getState();
    const persisted = JSON.parse(localStorage.getItem("chesster-game")!).state;
    expect(persisted).toMatchObject({
      puzzleRating: state.puzzleRating,
      puzzleRD: state.puzzleRD,
      puzzleVolatility: state.puzzleVolatility,
      ratedPuzzleIds: ["one"],
    });
    // Restore in-memory defaults without altering the saved archive, then hydrate.
    const archive = localStorage.getItem("chesster-game")!;
    useGameStore.setState({ puzzleRating: DEFAULT_PUZZLE_RATING.rating });
    localStorage.setItem("chesster-game", archive);
    await useGameStore.persist.rehydrate();
    expect(useGameStore.getState().puzzleRating).toBe(state.puzzleRating);
  });
  it("rates each puzzle once and retains ratings when leaving a chess match", () => {
    const store = useGameStore.getState();
    store.updatePuzzleRating(1500, false, "one");
    const rating = useGameStore.getState().puzzleRating;
    expect(store.updatePuzzleRating(1500, true, "one")).toBeNull();
    store.reset();
    expect(useGameStore.getState().puzzleRating).toBe(rating);
  });
});
