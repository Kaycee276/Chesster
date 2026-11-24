import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useThemeStore } from "../src/store/themeStore";
import { type MoveHighlightColor } from "../src/utils/moveHighlights";

beforeEach(() => {
  localStorage.clear();
  useThemeStore.setState({ moveHighlightColor: "emerald", soundPack: "wood" });
});
afterEach(() => localStorage.clear());

describe("persisted legal move highlight preferences", () => {
  it("persists presets and custom colors without losing the sound preference", async () => {
    useThemeStore.getState().setSoundPack("metallic");
    useThemeStore.getState().setMoveHighlightColor("sapphire");
    expect(JSON.parse(localStorage.getItem("chesster_theme")!).state).toMatchObject({
      moveHighlightColor: "sapphire", soundPack: "metallic",
    });
    useThemeStore.getState().setMoveHighlightColor("#AB12EF");
    expect(useThemeStore.getState().moveHighlightColor).toBe("#ab12ef");
    useThemeStore.setState({ moveHighlightColor: "emerald", soundPack: "wood" });
    localStorage.setItem("chesster_theme", JSON.stringify({
      state: { moveHighlightColor: "#ab12ef", soundPack: "metallic" }, version: 0,
    }));
    await useThemeStore.persist.rehydrate();
    expect(useThemeStore.getState().moveHighlightColor).toBe("#ab12ef");
    expect(useThemeStore.getState().soundPack).toBe("metallic");
    expect(typeof useThemeStore.getState().setSoundPack).toBe("function");
  });

  it.each(["ruby", "amber", "monochrome"] as const)("updates %s immediately", (color) => {
    useThemeStore.getState().setMoveHighlightColor(color);
    expect(useThemeStore.getState().moveHighlightColor).toBe(color);
  });

  it.each(["url(https://example.invalid)", "#fff", "#12345g", "unknown", null])(
    "rejects an invalid runtime choice %p", (value) => {
      useThemeStore.getState().setMoveHighlightColor("sapphire");
      useThemeStore.getState().setMoveHighlightColor(value as MoveHighlightColor);
      expect(useThemeStore.getState().moveHighlightColor).toBe("sapphire");
    },
  );

  it("defaults corrupt persisted choices and cannot overwrite store actions", async () => {
    localStorage.setItem("chesster_theme", JSON.stringify({
      state: { moveHighlightColor: "invalid", setMoveHighlightColor: "injected", setSoundPack: "injected" },
      version: 0,
    }));
    await useThemeStore.persist.rehydrate();
    expect(useThemeStore.getState().moveHighlightColor).toBe("emerald");
    useThemeStore.getState().setMoveHighlightColor("monochrome");
    useThemeStore.getState().setSoundPack("retro");
    expect(useThemeStore.getState()).toMatchObject({ moveHighlightColor: "monochrome", soundPack: "retro" });
  });

  it("loads older preferences that did not have a highlight choice", async () => {
    localStorage.setItem("chesster_theme", JSON.stringify({ state: { boardTheme: "wood" }, version: 0 }));
    await useThemeStore.persist.rehydrate();
    expect(useThemeStore.getState().boardTheme).toBe("wood");
    expect(useThemeStore.getState().moveHighlightColor).toBe("emerald");
  });
});
