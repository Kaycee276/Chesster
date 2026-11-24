import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePwaInstall } from "./usePwaInstall";
import { useOfflineDetection } from "./useOfflineDetection";
import { offlineRedirect } from "../utils/pwaRoutes";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function offerInstall(outcome: "accepted" | "dismissed" = "accepted", fails = false) {
  const event = new Event("beforeinstallprompt", { cancelable: true });
  const prompt = fails ? vi.fn().mockRejectedValue(new Error("Browser denied")) : vi.fn().mockResolvedValue(undefined);
  Object.defineProperties(event, {
    prompt: { value: prompt },
    userChoice: { value: Promise.resolve({ outcome, platform: "web" }) },
  });
  act(() => window.dispatchEvent(event));
  return { event, prompt };
}

describe("PWA installation", () => {
  it("offers only a real browser prompt and consumes an accepted prompt once", async () => {
    const { result } = renderHook(usePwaInstall);
    expect(result.current.canInstall).toBe(false);
    const { event, prompt } = offerInstall();
    expect(event.defaultPrevented).toBe(true);
    expect(result.current.canInstall).toBe(true);
    await act(async () => { await result.current.install(); });
    expect(prompt).toHaveBeenCalledOnce();
    expect(result.current.canInstall).toBe(false);
    expect(result.current.installed).toBe(true);
    await act(async () => { await result.current.install(); });
    expect(prompt).toHaveBeenCalledOnce();
  });

  it("handles dismissal without claiming installation, then accepts a new offer", async () => {
    const { result } = renderHook(usePwaInstall);
    offerInstall("dismissed");
    await act(async () => { await result.current.install(); });
    expect(result.current.installed).toBe(false);
    expect(result.current.canInstall).toBe(false);
    offerInstall();
    expect(result.current.canInstall).toBe(true);
    act(() => window.dispatchEvent(new Event("appinstalled")));
    expect(result.current.canInstall).toBe(false);
    expect(result.current.installed).toBe(true);
  });

  it("reports prompt failures and permits a later browser offer", async () => {
    const { result } = renderHook(usePwaInstall);
    offerInstall("accepted", true);
    await act(async () => { await result.current.install(); });
    expect(result.current.error).toMatch(/could not install/i);
    expect(result.current.installing).toBe(false);
    offerInstall();
    expect(result.current.error).toBe("");
    expect(result.current.canInstall).toBe(true);
  });

  it("prevents two callers from reusing the same pending browser offer", async () => {
    const { result } = renderHook(usePwaInstall);
    let release!: () => void;
    const prompt = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const event = new Event("beforeinstallprompt", { cancelable: true });
    Object.defineProperties(event, {
      prompt: { value: prompt },
      userChoice: { value: Promise.resolve({ outcome: "accepted", platform: "web" }) },
    });
    act(() => window.dispatchEvent(event));
    await act(async () => {
      const first = result.current.install();
      const second = result.current.install();
      expect(prompt).toHaveBeenCalledOnce();
      release();
      await Promise.all([first, second]);
    });
    expect(result.current.installed).toBe(true);
  });

  it("removes listeners on unmount", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(usePwaInstall);
    unmount();
    expect(remove).toHaveBeenCalledWith("beforeinstallprompt", expect.any(Function));
    expect(remove).toHaveBeenCalledWith("appinstalled", expect.any(Function));
  });
});

describe("offline navigation", () => {
  it("follows online/offline events and removes subscriptions", () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const { result, unmount } = renderHook(useOfflineDetection);
    expect(result.current).toBe(false);
    online.mockReturnValue(false);
    act(() => window.dispatchEvent(new Event("offline")));
    expect(result.current).toBe(true);
    online.mockReturnValue(true);
    act(() => window.dispatchEvent(new Event("online")));
    expect(result.current).toBe(false);
    const remove = vi.spyOn(window, "removeEventListener");
    unmount();
    expect(remove).toHaveBeenCalledWith("offline", expect.any(Function));
  });

  it("keeps local play/replays available and sends network routes to the launcher", () => {
    expect(offlineRedirect("/offline-play", true)).toBeNull();
    expect(offlineRedirect("/offline-games", true)).toBeNull();
    expect(offlineRedirect("/tournaments", true)).toBe("/offline-games");
    expect(offlineRedirect("/ABC123", true)).toBe("/offline-games");
    expect(offlineRedirect("/", false)).toBeNull();
  });
});
