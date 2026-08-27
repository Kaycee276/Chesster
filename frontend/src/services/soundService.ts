/**
 * soundService.ts
 *
 * Synthesises chess sound effects using the Web Audio API.
 * No audio files needed — all sounds are generated in-browser.
 *
 * Usage:
 *   import { soundService } from "../services/soundService";
 *   soundService.move();
 *   soundService.setEnabled(false);
 *   soundService.setVolume(0.5);
 */

type OscType = OscillatorType;

const LS_MUTED_KEY = "chesster:sound:muted";
const LS_VOLUME_KEY = "chesster:sound:volume";

class SoundService {
  private ctx: AudioContext | null = null;
  private _enabled = localStorage.getItem(LS_MUTED_KEY) !== "true";
  private _volume = Math.min(1, Math.max(0, parseFloat(localStorage.getItem(LS_VOLUME_KEY) ?? "1") || 1));

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

  // ── Sound effects ─────────────────────────────────────────────────────────

  /** Piece moved to an empty square */
  move() {
    this.tone(520, 0.08, "square", 0.18);
  }

  /** Piece captured another */
  capture() {
    this.tone(300, 0.08, "sawtooth", 0.28);
    this.tone(220, 0.12, "sawtooth", 0.20, 0.07);
  }

  /** King is in check */
  check() {
    this.tone(880, 0.12, "sine", 0.30);
    this.tone(880, 0.12, "sine", 0.30, 0.18);
  }

  /** Castling move */
  castle() {
    this.tone(440, 0.09, "square", 0.18);
    this.tone(550, 0.09, "square", 0.18, 0.10);
  }

  /** Pawn promotion */
  promote() {
    [440, 550, 660, 880].forEach((f, i) =>
      this.tone(f, 0.10, "sine", 0.22, i * 0.08),
    );
  }

  /** Both players joined — game is starting */
  gameStart() {
    [330, 440, 550, 660].forEach((f, i) =>
      this.tone(f, 0.12, "sine", 0.22, i * 0.10),
    );
  }

  /** Game ended (win/loss) */
  gameEnd() {
    [660, 550, 440, 330, 220].forEach((f, i) =>
      this.tone(f, 0.15, "sine", 0.22, i * 0.12),
    );
  }

  /** Game ended in a draw */
  draw() {
    this.tone(440, 0.15, "sine", 0.22);
    this.tone(440, 0.15, "sine", 0.22, 0.22);
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
}

export const soundService = new SoundService();
