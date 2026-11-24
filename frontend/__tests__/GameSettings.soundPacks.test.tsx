import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import GameSettings from "../src/components/GameSettings";
import { useGameStore } from "../src/store/gameStore";
import { useThemeStore } from "../src/store/themeStore";
import { soundService } from "../src/services/soundService";

beforeEach(() => {
  localStorage.clear();
  useThemeStore.getState().setSoundPack("wood");
  useGameStore.setState({ isSettingsOpen: true });
});

afterEach(() => {
  cleanup();
  useGameStore.setState({ isSettingsOpen: false });
  vi.restoreAllMocks();
});

describe("GameSettings sound pack preference", () => {
  it("selects and persists the requested packs through the theme store", () => {
    render(<GameSettings hideFloating />);
    const selector = screen.getByRole("combobox", { name: "Sound pack" });
    for (const pack of ["wood", "retro", "metallic", "default"]) {
      fireEvent.change(selector, { target: { value: pack } });
      expect(useThemeStore.getState().soundPack).toBe(pack);
      expect(soundService.getSoundPack()).toBe(pack);
      expect(JSON.parse(localStorage.getItem("chesster_theme")!).state.soundPack).toBe(pack);
    }
  });

  it("previews the selected pack without a temporary preference change", () => {
    const preview = vi.spyOn(soundService, "previewSound").mockImplementation(() => {});
    render(<GameSettings hideFloating />);
    fireEvent.change(screen.getByRole("combobox", { name: "Sound pack" }), { target: { value: "metallic" } });
    fireEvent.click(screen.getByRole("button", { name: "Test sound" }));
    expect(preview).toHaveBeenCalledWith("move", "metallic");
    expect(useThemeStore.getState().soundPack).toBe("metallic");
  });
});
