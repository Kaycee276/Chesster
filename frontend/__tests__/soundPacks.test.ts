import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class AudioParamMock {
  setValueAtTime = vi.fn();
  linearRampToValueAtTime = vi.fn();
  exponentialRampToValueAtTime = vi.fn();
}

class NodeMock {
  connect = vi.fn();
  disconnect = vi.fn();
}

class SourceMock extends NodeMock {
  onended: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
}

class OscillatorMock extends SourceMock {
  type: OscillatorType = "sine";
  frequency = new AudioParamMock();
}

class GainMock extends NodeMock {
  gain = new AudioParamMock();
}

class FilterMock extends NodeMock {
  type: BiquadFilterType = "lowpass";
  frequency = new AudioParamMock();
  Q = new AudioParamMock();
}

class BufferSourceMock extends SourceMock {
  buffer: AudioBuffer | null = null;
}

class AudioContextMock {
  static instances: AudioContextMock[] = [];
  currentTime = 3;
  sampleRate = 48000;
  state: AudioContextState = "running";
  destination = new NodeMock();
  oscillators: OscillatorMock[] = [];
  gains: GainMock[] = [];
  sources: BufferSourceMock[] = [];
  filters: FilterMock[] = [];
  resume = vi.fn().mockResolvedValue(undefined);

  constructor() {
    AudioContextMock.instances = [...AudioContextMock.instances, this];
  }

  createOscillator() {
    const node = new OscillatorMock();
    this.oscillators = [...this.oscillators, node];
    return node;
  }

  createGain() {
    const node = new GainMock();
    this.gains = [...this.gains, node];
    return node;
  }

  createBiquadFilter() {
    const node = new FilterMock();
    this.filters = [...this.filters, node];
    return node;
  }

  createBufferSource() {
    const node = new BufferSourceMock();
    this.sources = [...this.sources, node];
    return node;
  }

  createBuffer(_channels: number, length: number, _sampleRate: number) {
    return { getChannelData: () => new Float32Array(length) } as unknown as AudioBuffer;
  }
}

async function loadAudio() {
  const service = await import("../src/services/soundService");
  const theme = await import("../src/store/themeStore");
  return { sound: service.soundService, store: theme.useThemeStore };
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  AudioContextMock.instances = [];
  vi.stubGlobal("AudioContext", AudioContextMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("custom sound packs", () => {
  it("plays a low triangle with pitch decay for wood", async () => {
    const { sound } = await loadAudio();
    sound.setSoundPack("wood");
    sound.move();
    const ctx = AudioContextMock.instances[0];
    const oscillator = ctx.oscillators[0];
    expect(oscillator.type).toBe("triangle");
    expect(oscillator.frequency.setValueAtTime).toHaveBeenCalledWith(140, 3);
    expect(oscillator.frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(40, 3.08);
    expect(oscillator.connect).toHaveBeenCalledWith(ctx.gains[0]);
    expect(ctx.gains[0].connect).toHaveBeenCalledWith(ctx.destination);
  });

  it("schedules the retro move arpeggio on the audio clock", async () => {
    const { sound } = await loadAudio();
    sound.setSoundPack("retro");
    sound.move();
    const notes = AudioContextMock.instances[0].oscillators;
    expect(notes).toHaveLength(3);
    expect(notes.map((note) => note.type)).toEqual(["square", "square", "square"]);
    expect(notes.map((note) => note.frequency.setValueAtTime.mock.calls[0][0])).toEqual([800, 1000, 1200]);
    expect(notes.map((note) => note.start.mock.calls[0][0])).toEqual([3, 3.035, 3.07]);
  });

  it("combines bandpass noise with a high resonance for metallic", async () => {
    const { sound } = await loadAudio();
    sound.setSoundPack("metallic");
    sound.move();
    const ctx = AudioContextMock.instances[0];
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.filters[0].type).toBe("bandpass");
    expect(ctx.sources[0].buffer).not.toBeNull();
    expect(ctx.sources[0].connect).toHaveBeenCalledWith(ctx.filters[0]);
    expect(ctx.filters[0].connect).toHaveBeenCalledWith(ctx.gains[0]);
    expect(ctx.oscillators[0].frequency.setValueAtTime.mock.calls[0][0]).toBeGreaterThan(1000);
  });

  it.each(["capture", "check", "gameEnd"] as const)("synthesizes metallic %s feedback", async (effect) => {
    const { sound } = await loadAudio();
    sound.setSoundPack("metallic");
    sound[effect]();
    expect(AudioContextMock.instances[0].sources.length).toBeGreaterThan(0);
    expect(AudioContextMock.instances[0].oscillators.length).toBeGreaterThan(0);
  });

  it("disconnects metallic sources, filters, gains and resonances after playback", async () => {
    const { sound } = await loadAudio();
    sound.setSoundPack("metallic");
    sound.move();
    const ctx = AudioContextMock.instances[0];
    ctx.sources[0].onended?.();
    ctx.oscillators[0].onended?.();
    expect(ctx.sources[0].disconnect).toHaveBeenCalledOnce();
    expect(ctx.filters[0].disconnect).toHaveBeenCalledOnce();
    expect(ctx.gains.every((gain) => gain.disconnect.mock.calls.length === 1)).toBe(true);
    expect(ctx.oscillators[0].disconnect).toHaveBeenCalledOnce();
  });

  it("disconnects ordinary oscillator and gain nodes after playback", async () => {
    const { sound } = await loadAudio();
    sound.setSoundPack("default");
    sound.move();
    const ctx = AudioContextMock.instances[0];
    ctx.oscillators[0].onended?.();
    expect(ctx.oscillators[0].disconnect).toHaveBeenCalledOnce();
    expect(ctx.gains[0].disconnect).toHaveBeenCalledOnce();
  });

  it("previewing a different pack leaves the saved selection unchanged", async () => {
    const { sound, store } = await loadAudio();
    sound.setSoundPack("wood");
    const saved = localStorage.getItem("chesster_theme");
    sound.previewSound("move", "metallic");
    expect(AudioContextMock.instances[0].sources).toHaveLength(1);
    expect(sound.getSoundPack()).toBe("wood");
    expect(store.getState().soundPack).toBe("wood");
    expect(localStorage.getItem("chesster_theme")).toBe(saved);
    expect(localStorage.getItem("chesster_sound_pack")).toBe("wood");
    sound.setSoundPack("retro");
    expect(sound.getSoundPack()).toBe("retro");
  });

  it("loads the theme preference and uses it in gameplay calls", async () => {
    localStorage.setItem("chesster_theme", JSON.stringify({ state: { soundPack: "metallic" }, version: 0 }));
    const { sound, store } = await loadAudio();
    expect(sound.getSoundPack()).toBe("metallic");
    store.getState().setSoundPack("retro");
    sound.move();
    expect(AudioContextMock.instances[0].oscillators).toHaveLength(3);
    expect(JSON.parse(localStorage.getItem("chesster_theme")!).state.soundPack).toBe("retro");
  });

  it("migrates the legacy preference when existing themes have no sound field", async () => {
    localStorage.setItem("chesster_sound_pack", "retro");
    localStorage.setItem("chesster_theme", JSON.stringify({ state: { boardTheme: "neon" }, version: 0 }));
    const { sound, store } = await loadAudio();
    expect(sound.getSoundPack()).toBe("retro");
    expect(store.getState().boardTheme).toBe("neon");
  });

  it("rejects corrupt persisted packs while retaining working actions", async () => {
    localStorage.setItem("chesster_theme", JSON.stringify({
      state: { soundPack: "__proto__", setSoundPack: "broken" }, version: 0,
    }));
    const { sound, store } = await loadAudio();
    expect(sound.getSoundPack()).toBe("wood");
    store.getState().setSoundPack("metallic");
    expect(sound.getSoundPack()).toBe("metallic");
    sound.setSoundPack("unknown" as "wood");
    expect(sound.getSoundPack()).toBe("metallic");
  });

  it("preserves persisted zero volume and mute when previewing", async () => {
    localStorage.setItem("chesster:sound:volume", "0");
    const { sound } = await loadAudio();
    expect(sound.getVolume()).toBe(0);
    sound.setEnabled(false);
    sound.previewSound("move", "metallic");
    expect(AudioContextMock.instances).toHaveLength(0);
    expect(sound.getVolume()).toBe(0);
  });

  it("resumes a suspended context for a user gesture preview", async () => {
    const { sound } = await loadAudio();
    sound.getAudioContext();
    const ctx = AudioContextMock.instances[0];
    ctx.state = "suspended";
    sound.previewSound("move", "retro");
    expect(ctx.resume).toHaveBeenCalled();
    expect(ctx.oscillators).toHaveLength(3);
  });
});
