import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import MoveHighlightPicker from "../src/components/MoveHighlightPicker";
import GameSettings from "../src/components/GameSettings";
import { useGameStore } from "../src/store/gameStore";
import { useThemeStore } from "../src/store/themeStore";

beforeEach(() => {
  localStorage.clear();
  useThemeStore.getState().setMoveHighlightColor("emerald");
  useGameStore.setState({ isSettingsOpen: true });
});
afterEach(() => {
  cleanup();
  useGameStore.setState({ isSettingsOpen: false });
});

describe("legal move highlight controls", () => {
  it("offers named presets with their selected state and native button activation", () => {
    render(<MoveHighlightPicker />);
    expect(screen.getByRole("button", { name: "Emerald Green legal move highlights" })).toHaveAttribute("aria-pressed", "true");
    const blue = screen.getByRole("button", { name: "Sapphire Blue legal move highlights" });
    fireEvent.click(blue);
    expect(blue).toHaveAttribute("aria-pressed", "true");
    expect(useThemeStore.getState().moveHighlightColor).toBe("sapphire");
    fireEvent.click(screen.getByRole("button", { name: "Monochrome Outline legal move highlights" }));
    expect(useThemeStore.getState().moveHighlightColor).toBe("monochrome");
  });

  it("accepts a custom color and persists it", () => {
    render(<MoveHighlightPicker />);
    fireEvent.change(screen.getByLabelText("Custom legal move highlight color"), { target: { value: "#aabbcc" } });
    expect(useThemeStore.getState().moveHighlightColor).toBe("#aabbcc");
    expect(JSON.parse(localStorage.getItem("chesster_theme")!).state.moveHighlightColor).toBe("#aabbcc");
    expect(screen.getByText("Custom color selected")).toBeVisible();
  });

  it("is available in the standalone game settings dialog", () => {
    render(<GameSettings hideFloating />);
    fireEvent.click(screen.getByRole("button", { name: "Ruby Red legal move highlights" }));
    expect(useThemeStore.getState().moveHighlightColor).toBe("ruby");
  });
});
