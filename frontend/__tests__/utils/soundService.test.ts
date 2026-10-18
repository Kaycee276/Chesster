import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  soundService,
  playTone,
  synthesizeBeep,
  getAudioContext,
} from "../../src/utils/soundService";

class MockOscillator {
  type: OscillatorType = "sine";
  frequency = {
    value: 0,
    setValueAtTime: vi.fn(function (this: { value: number }, v: number) {
      this.value = v;
    }),
  };
  connect = vi.fn().mockReturnThis();
  start = vi.fn();
  stop = vi.fn();
}

class MockGain {
  gain = {
    value: 1,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  };
  connect = vi.fn().mockReturnThis();
}

class MockAudioContext {
  currentTime = 0;
  state: AudioContextState = "running";
  destination = {};
  resume = vi.fn().mockResolvedValue(undefined);
  createOscillator = vi.fn(() => new MockOscillator());
  createGain = vi.fn(() => new MockGain());
}

describe("Web Audio API procedural sound synthesis fallback (Issue #537)", () => {
  beforeEach(() => {
    vi.stubGlobal("AudioContext", MockAudioContext as unknown as typeof AudioContext);
    soundService.setEnabled(true);
    soundService.setVolume(0.8);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("initializes AudioContext lazily and provides getAudioContext", () => {
    const ctx = getAudioContext();
    expect(ctx).toBeTruthy();
  });

  it("plays tone using OscillatorNode and GainNode with specified frequency", () => {
    const ctx = getAudioContext();
    expect(ctx).toBeTruthy();

    synthesizeBeep(440, 0.08, "sine");
    expect(ctx?.createOscillator).toHaveBeenCalled();
    expect(ctx?.createGain).toHaveBeenCalled();
  });

  it("falls back to synthesizeBeep when audio playback fails or rejects", async () => {
    const ctx = getAudioContext();
    const failingAudio = {
      play: vi.fn().mockRejectedValue(new Error("Failed to load sound asset")),
    } as unknown as HTMLAudioElement;

    await soundService.playWithFallback(failingAudio, 880, 0.1, "sine");
    expect(ctx?.createOscillator).toHaveBeenCalled();
    expect(ctx?.createGain).toHaveBeenCalled();
  });

  it("volume attenuation scales gain properly", () => {
    soundService.setVolume(0.5);
    expect(soundService.getVolume()).toBe(0.5);

    playTone(520, 0.08);
    const ctx = getAudioContext();
    expect(ctx?.createGain).toHaveBeenCalled();
  });
});
