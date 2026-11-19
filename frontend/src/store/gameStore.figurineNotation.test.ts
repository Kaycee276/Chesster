import { describe, it, expect, beforeEach } from "vitest";
import { useGameStore } from "./gameStore";

describe("Figurine Notation in gameStore", () => {
  beforeEach(() => {
    useGameStore.setState({ isFigurineNotation: false });
  });

  it("initializes isFigurineNotation as false", () => {
    const state = useGameStore.getState();
    expect(state.isFigurineNotation).toBe(false);
  });

  it("toggles isFigurineNotation correctly", () => {
    const { toggleFigurineNotation } = useGameStore.getState();
    expect(useGameStore.getState().isFigurineNotation).toBe(false);

    toggleFigurineNotation();
    expect(useGameStore.getState().isFigurineNotation).toBe(true);

    toggleFigurineNotation();
    expect(useGameStore.getState().isFigurineNotation).toBe(false);
  });

  it("sets isFigurineNotation explicitly", () => {
    const { setFigurineNotation } = useGameStore.getState();
    setFigurineNotation(true);
    expect(useGameStore.getState().isFigurineNotation).toBe(true);

    setFigurineNotation(false);
    expect(useGameStore.getState().isFigurineNotation).toBe(false);
  });
});
