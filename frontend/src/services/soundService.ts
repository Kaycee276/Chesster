/**
 * soundService.ts
 *
 * Synthesises chess sound effects using the Web Audio API.
 * No audio files needed — all sounds are generated in-browser.
 *
 * Supports 4 sound packs:
 *   - wood: Classic wooden piece sounds
 *   - plastic: Modern plastic piece sounds
 *   - arcade: Retro arcade synth sounds
 *   - retro: 8-bit retro chiptune sounds
 *
 * Usage:
 *   import { soundService } from "../services/soundService";
 *   soundService.move();
 *   soundService.setEnabled(false);
 *   soundService.setVolume(0.5);
 *   soundService.setSoundPack('arcade');
 */

type OscType = OscillatorType;

export type SoundPack = "wood" | "plastic" | "arcade" | "retro";

const LS_MUTED_KEY = "chesster:sound:muted";
const LS_VOLUME_KEY = "chesster:sound:volume";
const LS_SOUND_PACK_KEY = "chesster_sound_pack";

interface SoundProfile {
  move: Array<{ freq: number; duration: number; type: OscType; volume: number; delay: number }>;
  capture: Array<{ freq: number; duration: number; type: OscType; volume: number; delay: number }>;
  check: Array<{ freq: number; duration: number; type: OscType; volume: number; delay: number }>;
  castle: Array<{ freq: number; duration: number; type: OscType; volume: number; delay: number }>;
  promote: Array<{ freq: number; duration: number; type: OscType; volume: number; delay: number }>;
  gameStart: Array<{ freq: number; duration: number; type: OscType; volume: number; delay: number }>;
  gameEnd: Array<{ freq: number; duration: number; type: OscType; volume: number; delay: number }>;
  draw: Array<{ freq: number; duration: number; type: OscType; volume: number; delay: number }>;
  lowTimeTick: Array<{ freq: number; duration: number; type: OscType; volume: number; delay: number }>;
}

/**
 * Sound profiles for each pack. Each profile contains tone parameters
 * for every sound effect, allowing each pack to have its own character.
 */
const SOUND_PROFILES: Record<SoundPack, SoundProfile> = {
  wood: {
    // Classic wooden piece sounds - warm and mellow
    move: [{ freq: 520, duration: 0.08, type: "square", volume: 0.18, delay: 0 }],
    capture: [
      { freq: 300, duration: 0.08, type: "sawtooth", volume: 0.28, delay: 0 },
      { freq: 220, duration: 0.12, type: "sawtooth", volume: 0.2, delay: 0.07 },
    ],
    check: [
      { freq: 880, duration: 0.12, type: "sine", volume: 0.3, delay: 0 },
      { freq: 880, duration: 0.12, type: "sine", volume: 0.3, delay: 0.18 },
    ],
    castle: [
      { freq: 440, duration: 0.09, type: "square", volume: 0.18, delay: 0 },
      { freq: 550, duration: 0.09, type: "square", volume: 0.18, delay: 0.1 },
    ],
    promote: [
      { freq: 440, duration: 0.1, type: "sine", volume: 0.22, delay: 0 },
      { freq: 550, duration: 0.1, type: "sine", volume: 0.22, delay: 0.08 },
      { freq: 660, duration: 0.1, type: "sine", volume: 0.22, delay: 0.16 },
      { freq: 880, duration: 0.1, type: "sine", volume: 0.22, delay: 0.24 },
    ],
    gameStart: [
      { freq: 330, duration: 0.12, type: "sine", volume: 0.22, delay: 0 },
      { freq: 440, duration: 0.12, type: "sine", volume: 0.22, delay: 0.1 },
      { freq: 550, duration: 0.12, type: "sine", volume: 0.22, delay: 0.2 },
      { freq: 660, duration: 0.12, type: "sine", volume: 0.22, delay: 0.3 },
    ],
    gameEnd: [
      { freq: 660, duration: 0.15, type: "sine", volume: 0.22, delay: 0 },
      { freq: 550, duration: 0.15, type: "sine", volume: 0.22, delay: 0.12 },
      { freq: 440, duration: 0.15, type: "sine", volume: 0.22, delay: 0.24 },
      { freq: 330, duration: 0.15, type: "sine", volume: 0.22, delay: 0.36 },
      { freq: 220, duration: 0.15, type: "sine", volume: 0.22, delay: 0.48 },
    ],
    draw: [
      { freq: 440, duration: 0.15, type: "sine", volume: 0.22, delay: 0 },
      { freq: 440, duration: 0.15, type: "sine", volume: 0.22, delay: 0.22 },
    ],
    lowTimeTick: [
      { freq: 1200, duration: 0.05, type: "sine", volume: 0.2, delay: 0 },
    ],
  },
  plastic: {
    // Modern plastic piece sounds - brighter and snappier
    move: [{ freq: 680, duration: 0.06, type: "triangle", volume: 0.2, delay: 0 }],
    capture: [
      { freq: 440, duration: 0.07, type: "triangle", volume: 0.25, delay: 0 },
      { freq: 330, duration: 0.1, type: "triangle", volume: 0.18, delay: 0.05 },
    ],
    check: [
      { freq: 1000, duration: 0.1, type: "sine", volume: 0.28, delay: 0 },
      { freq: 1000, duration: 0.1, type: "sine", volume: 0.28, delay: 0.15 },
    ],
    castle: [
      { freq: 550, duration: 0.08, type: "triangle", volume: 0.2, delay: 0 },
      { freq: 700, duration: 0.08, type: "triangle", volume: 0.2, delay: 0.09 },
    ],
    promote: [
      { freq: 550, duration: 0.09, type: "triangle", volume: 0.2, delay: 0 },
      { freq: 660, duration: 0.09, type: "triangle", volume: 0.2, delay: 0.07 },
      { freq: 780, duration: 0.09, type: "triangle", volume: 0.2, delay: 0.14 },
      { freq: 1000, duration: 0.09, type: "triangle", volume: 0.2, delay: 0.21 },
    ],
    gameStart: [
      { freq: 440, duration: 0.1, type: "triangle", volume: 0.2, delay: 0 },
      { freq: 550, duration: 0.1, type: "triangle", volume: 0.2, delay: 0.08 },
      { freq: 660, duration: 0.1, type: "triangle", volume: 0.2, delay: 0.16 },
      { freq: 800, duration: 0.1, type: "triangle", volume: 0.2, delay: 0.24 },
    ],
    gameEnd: [
      { freq: 800, duration: 0.12, type: "triangle", volume: 0.2, delay: 0 },
      { freq: 660, duration: 0.12, type: "triangle", volume: 0.2, delay: 0.1 },
      { freq: 550, duration: 0.12, type: "triangle", volume: 0.2, delay: 0.2 },
      { freq: 440, duration: 0.12, type: "triangle", volume: 0.2, delay: 0.3 },
      { freq: 330, duration: 0.12, type: "triangle", volume: 0.2, delay: 0.4 },
    ],
    draw: [
      { freq: 550, duration: 0.12, type: "triangle", volume: 0.2, delay: 0 },
      { freq: 550, duration: 0.12, type: "triangle", volume: 0.2, delay: 0.2 },
    ],
    lowTimeTick: [
      { freq: 1400, duration: 0.04, type: "triangle", volume: 0.2, delay: 0 },
    ],
  },
  arcade: {
    // Retro arcade synth sounds - 80s arcade machine vibe
    move: [{ freq: 400, duration: 0.1, type: "sawtooth", volume: 0.15, delay: 0 }],
    capture: [
      { freq: 600, duration: 0.06, type: "sawtooth", volume: 0.2, delay: 0 },
      { freq: 300, duration: 0.1, type: "sawtooth", volume: 0.15, delay: 0.04 },
    ],
    check: [
      { freq: 1200, duration: 0.08, type: "sawtooth", volume: 0.25, delay: 0 },
      { freq: 1200, duration: 0.08, type: "sawtooth", volume: 0.25, delay: 0.12 },
    ],
    castle: [
      { freq: 600, duration: 0.08, type: "sawtooth", volume: 0.15, delay: 0 },
      { freq: 800, duration: 0.08, type: "sawtooth", volume: 0.15, delay: 0.1 },
    ],
    promote: [
      { freq: 400, duration: 0.08, type: "sawtooth", volume: 0.15, delay: 0 },
      { freq: 600, duration: 0.08, type: "sawtooth", volume: 0.15, delay: 0.06 },
      { freq: 800, duration: 0.08, type: "sawtooth", volume: 0.15, delay: 0.12 },
      { freq: 1000, duration: 0.08, type: "sawtooth", volume: 0.15, delay: 0.18 },
    ],
    gameStart: [
      { freq: 400, duration: 0.1, type: "sawtooth", volume: 0.15, delay: 0 },
      { freq: 600, duration: 0.1, type: "sawtooth", volume: 0.15, delay: 0.08 },
      { freq: 800, duration: 0.1, type: "sawtooth", volume: 0.15, delay: 0.16 },
      { freq: 1000, duration: 0.1, type: "sawtooth", volume: 0.15, delay: 0.24 },
    ],
    gameEnd: [
      { freq: 1000, duration: 0.1, type: "sawtooth", volume: 0.15, delay: 0 },
      { freq: 800, duration: 0.1, type: "sawtooth", volume: 0.15, delay: 0.08 },
      { freq: 600, duration: 0.1, type: "sawtooth", volume: 0.15, delay: 0.16 },
      { freq: 400, duration: 0.1, type: "sawtooth", volume: 0.15, delay: 0.24 },
      { freq: 200, duration: 0.1, type: "sawtooth", volume: 0.15, delay: 0.32 },
    ],
    draw: [
      { freq: 600, duration: 0.1, type: "sawtooth", volume: 0.15, delay: 0 },
      { freq: 600, duration: 0.1, type: "sawtooth", volume: 0.15, delay: 0.2 },
    ],
    lowTimeTick: [
      { freq: 1600, duration: 0.04, type: "sawtooth", volume: 0.18, delay: 0 },
    ],
  },
  retro: {
    // 8-bit chiptune sounds - classic video game vibe
    move: [{ freq: 800, duration: 0.05, type: "square", volume: 0.15, delay: 0 }],
    capture: [
      { freq: 1200, duration: 0.05, type: "square", volume: 0.18, delay: 0 },
      { freq: 600, duration: 0.08, type: "square", volume: 0.15, delay: 0.03 },
    ],
    check: [
      { freq: 1600, duration: 0.07, type: "square", volume: 0.2, delay: 0 },
      { freq: 1600, duration: 0.07, type: "square", volume: 0.2, delay: 0.1 },
    ],
    castle: [
      { freq: 800, duration: 0.07, type: "square", volume: 0.15, delay: 0 },
      { freq: 1000, duration: 0.07, type: "square", volume: 0.15, delay: 0.08 },
    ],
    promote: [
      { freq: 600, duration: 0.07, type: "square", volume: 0.15, delay: 0 },
      { freq: 800, duration: 0.07, type: "square", volume: 0.15, delay: 0.05 },
      { freq: 1000, duration: 0.07, type: "square", volume: 0.15, delay: 0.1 },
      { freq: 1200, duration: 0.07, type: "square", volume: 0.15, delay: 0.15 },
    ],
    gameStart: [
      { freq: 600, duration: 0.08, type: "square", volume: 0.15, delay: 0 },
      { freq: 800, duration: 0.08, type: "square", volume: 0.15, delay: 0.06 },
      { freq: 1000, duration: 0.08, type: "square", volume: 0.15, delay: 0.12 },
      { freq: 1200, duration: 0.08, type: "square", volume: 0.15, delay: 0.18 },
    ],
    gameEnd: [
      { freq: 1200, duration: 0.08, type: "square", volume: 0.15, delay: 0 },
      { freq: 1000, duration: 0.08, type: "square", volume: 0.15, delay: 0.06 },
      { freq: 800, duration: 0.08, type: "square", volume: 0.15, delay: 0.12 },
      { freq: 600, duration: 0.08, type: "square", volume: 0.15, delay: 0.18 },
      { freq: 400, duration: 0.08, type: "square", volume: 0.15, delay: 0.24 },
    ],
    draw: [
      { freq: 800, duration: 0.08, type: "square", volume: 0.15, delay: 0 },
      { freq: 800, duration: 0.08, type: "square", volume: 0.15, delay: 0.18 },
    ],
    lowTimeTick: [
      { freq: 2000, duration: 0.03, type: "square", volume: 0.18, delay: 0 },
    ],
  },
};

class SoundService {
  private ctx: AudioContext | null = null;
  private _enabled = localStorage.getItem(LS_MUTED_KEY) !== "true";
  private _volume = Math.min(1, Math.max(0, parseFloat(localStorage.getItem(LS_VOLUME_KEY) ?? "1") || 1));
  private _soundPack: SoundPack = (localStorage.getItem(LS_SOUND_PACK_KEY) as SoundPack) || "wood";

  constructor() {
    // Validate and normalize the persisted pack
    if (!Object.keys(SOUND_PROFILES).includes(this._soundPack)) {
      this._soundPack = "wood";
    }
  }

  private getCtx(): AudioContext | null {
    if (!this._enabled) return null;
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return null;
      }
    }
    // Resume if suspended (browser autoplay policy)
    if (this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private tone(
    freq: number,
    duration: number,
    type: OscType = "sine",
    volume = 0.25,
    delay = 0,
  ) {
    const ctx = this.getCtx();
    if (!ctx) return;
    try {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      const scaledVolume = volume * this._volume;
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
      gain.gain.setValueAtTime(0, ctx.currentTime + delay);
      gain.gain.linearRampToValueAtTime(scaledVolume, ctx.currentTime + delay + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + duration);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + duration + 0.05);
    } catch {
      // ignore
    }
  }

  private playSoundEffect(effectKey: keyof SoundProfile) {
    const profile = SOUND_PROFILES[this._soundPack];
    const tones = profile[effectKey];
    tones.forEach((tone) => {
      this.tone(tone.freq, tone.duration, tone.type, tone.volume, tone.delay);
    });
  }

  // ── Sound effects ─────────────────────────────────────────────────────────

  /** Piece moved to an empty square */
  move() {
    this.playSoundEffect("move");
  }

  /** Piece captured another */
  capture() {
    this.playSoundEffect("capture");
  }

  /** King is in check */
  check() {
    this.playSoundEffect("check");
  }

  /** Castling move */
  castle() {
    this.playSoundEffect("castle");
  }

  /** Pawn promotion */
  promote() {
    this.playSoundEffect("promote");
  }

  /** Both players joined — game is starting */
  gameStart() {
    this.playSoundEffect("gameStart");
  }

  /** Game ended (win/loss) */
  gameEnd() {
    this.playSoundEffect("gameEnd");
  }

  /** Game ended in a draw */
  draw() {
    this.playSoundEffect("draw");
  }

  /** Low time warning tick (active player under 10 seconds) */
  lowTimeTick() {
    this.playSoundEffect("lowTimeTick");
  }

  /** Clock has dropped into the "urgent" low-time zone */
  lowTime() {
    this.tone(660, 0.06, "triangle", 0.20);
  }

  // ── Autoplay unlock ───────────────────────────────────────────────────────

  /**
   * Browsers only allow an AudioContext to start (or resume) inside a
   * user-gesture handler. Call this once from app start-up so the very
   * first click/keypress/touch silently warms up the context — later
   * sound calls then play instantly instead of being swallowed.
   */
  unlockOnFirstInteraction() {
    if (typeof window === "undefined") return;
    const events: Array<keyof WindowEventMap> = ["pointerdown", "keydown", "touchstart"];
    const unlock = () => {
      this.getCtx();
      events.forEach((evt) => window.removeEventListener(evt, unlock));
    };
    events.forEach((evt) => window.addEventListener(evt, unlock, { once: true, passive: true }));
  }

  // ── Enable / disable ──────────────────────────────────────────────────────

  setEnabled(value: boolean) {
    this._enabled = value;
    localStorage.setItem(LS_MUTED_KEY, String(!value));
  }

  isEnabled() {
    return this._enabled;
  }

  toggle() {
    this._enabled = !this._enabled;
    localStorage.setItem(LS_MUTED_KEY, String(!this._enabled));
    return this._enabled;
  }

  // ── Volume ────────────────────────────────────────────────────────────────

  setVolume(value: number) {
    this._volume = Math.min(1, Math.max(0, value));
    localStorage.setItem(LS_VOLUME_KEY, String(this._volume));
  }

  getVolume() {
    return this._volume;
  }

  // ── Sound pack ────────────────────────────────────────────────────────────

  setSoundPack(pack: SoundPack) {
    if (Object.keys(SOUND_PROFILES).includes(pack)) {
      this._soundPack = pack;
      localStorage.setItem(LS_SOUND_PACK_KEY, pack);
    }
  }

  getSoundPack(): SoundPack {
    return this._soundPack;
  }
}

export const soundService = new SoundService();
