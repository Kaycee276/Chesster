/**
 * soundService.ts
 *
 * Synthesises chess sound effects using the Web Audio API.
 * No audio files needed — all sounds are generated in-browser.
 *
 * Supports 9 sound packs (including the original presets):
 *   - default: Original mellow chess tones
 *   - metallic: Filtered noise impacts and high-frequency resonance
 *   - wood: Classic wooden piece sounds
 *   - plastic: Modern plastic piece sounds
 *   - arcade: Retro arcade synth sounds
 *   - retro: 8-bit retro chiptune sounds
 *   - classic-wood: Warm mellow woody tones (sine waves, lower frequencies)
 *   - modern-digital: Crisp synthesized digital tones (triangle waves, higher frequencies)
 *   - lofi-soft: Muted subtle organic tones (very low volume sine waves)
 *
 * Usage:
 *   import { soundService } from "../services/soundService";
 *   soundService.move();
 *   soundService.setEnabled(false);
 *   soundService.setVolume(0.5);
 *   soundService.setSoundPack('classic-wood');
 */

import { useThemeStore } from "../store/themeStore";
import { isSoundPack, type SoundPack } from "./soundPacks";
import { playMetallicTone } from "./metallicSound";
export type { SoundPack } from "./soundPacks";

type OscType = OscillatorType;

type ProfilePack = Exclude<SoundPack, "default" | "metallic">;

const LS_MUTED_KEY = "chesster:sound:muted";
const LS_VOLUME_KEY = "chesster:sound:volume";
interface SoundTone {
  freq: number;
  duration: number;
  type: OscType;
  volume: number;
  delay: number;
  endFreq?: number;
}

interface SoundProfile {
  move: SoundTone[];
  capture: SoundTone[];
  check: SoundTone[];
  castle: SoundTone[];
  promote: SoundTone[];
  gameStart: SoundTone[];
  gameEnd: SoundTone[];
  draw: SoundTone[];
  lowTimeTick: SoundTone[];
  brilliant: SoundTone[];
}

/**
 * Sound profiles for each pack. Each profile contains tone parameters
 * for every sound effect, allowing each pack to have its own character.
 */
const SOUND_PROFILES: Record<ProfilePack, SoundProfile> = {
  wood: {
    // Classic wooden piece sounds - warm and mellow
    move: [{ freq: 140, endFreq: 40, duration: 0.08, type: "triangle", volume: 0.18, delay: 0 }],
    capture: [
      { freq: 300, endFreq: 70, duration: 0.08, type: "triangle", volume: 0.28, delay: 0 },
      { freq: 220, endFreq: 50, duration: 0.12, type: "triangle", volume: 0.2, delay: 0.07 },
    ],
    check: [
      { freq: 880, duration: 0.12, type: "sine", volume: 0.3, delay: 0 },
      { freq: 880, duration: 0.12, type: "sine", volume: 0.3, delay: 0.18 },
    ],
    castle: [
      { freq: 440, endFreq: 90, duration: 0.09, type: "triangle", volume: 0.18, delay: 0 },
      { freq: 550, endFreq: 110, duration: 0.09, type: "triangle", volume: 0.18, delay: 0.1 },
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
    brilliant: [
      { freq: 523.25, duration: 0.1, type: "sine", volume: 0.25, delay: 0 },
      { freq: 659.25, duration: 0.1, type: "sine", volume: 0.25, delay: 0.08 },
      { freq: 783.99, duration: 0.12, type: "sine", volume: 0.28, delay: 0.16 },
      { freq: 1046.5, duration: 0.25, type: "sine", volume: 0.3, delay: 0.24 },
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
    brilliant: [
      { freq: 587.33, duration: 0.09, type: "triangle", volume: 0.22, delay: 0 },
      { freq: 739.99, duration: 0.09, type: "triangle", volume: 0.22, delay: 0.07 },
      { freq: 880, duration: 0.12, type: "triangle", volume: 0.25, delay: 0.14 },
      { freq: 1174.66, duration: 0.22, type: "triangle", volume: 0.28, delay: 0.22 },
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
    brilliant: [
      { freq: 500, duration: 0.08, type: "sawtooth", volume: 0.2, delay: 0 },
      { freq: 700, duration: 0.08, type: "sawtooth", volume: 0.2, delay: 0.06 },
      { freq: 900, duration: 0.08, type: "sawtooth", volume: 0.22, delay: 0.12 },
      { freq: 1300, duration: 0.2, type: "sawtooth", volume: 0.25, delay: 0.18 },
    ],
  },
  retro: {
    // 8-bit chiptune sounds - classic video game vibe
    move: [
      { freq: 800, duration: 0.045, type: "square", volume: 0.12, delay: 0 },
      { freq: 1000, duration: 0.045, type: "square", volume: 0.12, delay: 0.035 },
      { freq: 1200, duration: 0.045, type: "square", volume: 0.12, delay: 0.07 },
    ],
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
    brilliant: [
      { freq: 660, duration: 0.06, type: "square", volume: 0.18, delay: 0 },
      { freq: 880, duration: 0.06, type: "square", volume: 0.18, delay: 0.05 },
      { freq: 1100, duration: 0.08, type: "square", volume: 0.2, delay: 0.1 },
      { freq: 1760, duration: 0.18, type: "square", volume: 0.22, delay: 0.16 },
    ],
  },
  "classic-wood": {
    // Classic Wood — warm, mellow, woody tones using sine waves at slightly lower frequencies
    move: [{ freq: 460, duration: 0.09, type: "sine", volume: 0.16, delay: 0 }],
    capture: [
      { freq: 260, duration: 0.09, type: "sine", volume: 0.24, delay: 0 },
      { freq: 190, duration: 0.13, type: "sine", volume: 0.18, delay: 0.07 },
    ],
    check: [
      { freq: 760, duration: 0.13, type: "sine", volume: 0.28, delay: 0 },
      { freq: 760, duration: 0.13, type: "sine", volume: 0.28, delay: 0.18 },
    ],
    castle: [
      { freq: 380, duration: 0.1, type: "sine", volume: 0.16, delay: 0 },
      { freq: 480, duration: 0.1, type: "sine", volume: 0.16, delay: 0.1 },
    ],
    promote: [
      { freq: 380, duration: 0.11, type: "sine", volume: 0.2, delay: 0 },
      { freq: 480, duration: 0.11, type: "sine", volume: 0.2, delay: 0.09 },
      { freq: 570, duration: 0.11, type: "sine", volume: 0.2, delay: 0.18 },
      { freq: 760, duration: 0.11, type: "sine", volume: 0.2, delay: 0.27 },
    ],
    gameStart: [
      { freq: 280, duration: 0.13, type: "sine", volume: 0.2, delay: 0 },
      { freq: 380, duration: 0.13, type: "sine", volume: 0.2, delay: 0.1 },
      { freq: 480, duration: 0.13, type: "sine", volume: 0.2, delay: 0.2 },
      { freq: 570, duration: 0.13, type: "sine", volume: 0.2, delay: 0.3 },
    ],
    gameEnd: [
      { freq: 570, duration: 0.16, type: "sine", volume: 0.2, delay: 0 },
      { freq: 480, duration: 0.16, type: "sine", volume: 0.2, delay: 0.13 },
      { freq: 380, duration: 0.16, type: "sine", volume: 0.2, delay: 0.26 },
      { freq: 280, duration: 0.16, type: "sine", volume: 0.2, delay: 0.39 },
      { freq: 190, duration: 0.16, type: "sine", volume: 0.2, delay: 0.52 },
    ],
    draw: [
      { freq: 380, duration: 0.16, type: "sine", volume: 0.2, delay: 0 },
      { freq: 380, duration: 0.16, type: "sine", volume: 0.2, delay: 0.22 },
    ],
    lowTimeTick: [
      { freq: 1050, duration: 0.06, type: "sine", volume: 0.18, delay: 0 },
    ],
    brilliant: [
      { freq: 460, duration: 0.11, type: "sine", volume: 0.22, delay: 0 },
      { freq: 580, duration: 0.11, type: "sine", volume: 0.22, delay: 0.09 },
      { freq: 690, duration: 0.13, type: "sine", volume: 0.26, delay: 0.18 },
      { freq: 920, duration: 0.26, type: "sine", volume: 0.28, delay: 0.27 },
    ],
  },
  "modern-digital": {
    // Modern Digital — crisp synthesized tones using triangle waves at higher frequencies
    move: [{ freq: 820, duration: 0.06, type: "triangle", volume: 0.2, delay: 0 }],
    capture: [
      { freq: 560, duration: 0.07, type: "triangle", volume: 0.26, delay: 0 },
      { freq: 420, duration: 0.1, type: "triangle", volume: 0.2, delay: 0.05 },
    ],
    check: [
      { freq: 1200, duration: 0.1, type: "triangle", volume: 0.3, delay: 0 },
      { freq: 1200, duration: 0.1, type: "triangle", volume: 0.3, delay: 0.15 },
    ],
    castle: [
      { freq: 680, duration: 0.08, type: "triangle", volume: 0.2, delay: 0 },
      { freq: 860, duration: 0.08, type: "triangle", volume: 0.2, delay: 0.09 },
    ],
    promote: [
      { freq: 680, duration: 0.09, type: "triangle", volume: 0.22, delay: 0 },
      { freq: 820, duration: 0.09, type: "triangle", volume: 0.22, delay: 0.07 },
      { freq: 960, duration: 0.09, type: "triangle", volume: 0.22, delay: 0.14 },
      { freq: 1200, duration: 0.09, type: "triangle", volume: 0.22, delay: 0.21 },
    ],
    gameStart: [
      { freq: 560, duration: 0.1, type: "triangle", volume: 0.22, delay: 0 },
      { freq: 700, duration: 0.1, type: "triangle", volume: 0.22, delay: 0.08 },
      { freq: 840, duration: 0.1, type: "triangle", volume: 0.22, delay: 0.16 },
      { freq: 1050, duration: 0.1, type: "triangle", volume: 0.22, delay: 0.24 },
    ],
    gameEnd: [
      { freq: 1050, duration: 0.12, type: "triangle", volume: 0.22, delay: 0 },
      { freq: 840, duration: 0.12, type: "triangle", volume: 0.22, delay: 0.1 },
      { freq: 700, duration: 0.12, type: "triangle", volume: 0.22, delay: 0.2 },
      { freq: 560, duration: 0.12, type: "triangle", volume: 0.22, delay: 0.3 },
      { freq: 420, duration: 0.12, type: "triangle", volume: 0.22, delay: 0.4 },
    ],
    draw: [
      { freq: 700, duration: 0.12, type: "triangle", volume: 0.22, delay: 0 },
      { freq: 700, duration: 0.12, type: "triangle", volume: 0.22, delay: 0.2 },
    ],
    lowTimeTick: [
      { freq: 1600, duration: 0.04, type: "triangle", volume: 0.2, delay: 0 },
    ],
    brilliant: [
      { freq: 740, duration: 0.09, type: "triangle", volume: 0.24, delay: 0 },
      { freq: 930, duration: 0.09, type: "triangle", volume: 0.24, delay: 0.07 },
      { freq: 1110, duration: 0.12, type: "triangle", volume: 0.27, delay: 0.14 },
      { freq: 1480, duration: 0.22, type: "triangle", volume: 0.3, delay: 0.22 },
    ],
  },
  "lofi-soft": {
    // Lo-Fi Soft — muted, subtle, organic tones using very low volume sine waves
    move: [{ freq: 380, duration: 0.1, type: "sine", volume: 0.09, delay: 0 }],
    capture: [
      { freq: 220, duration: 0.1, type: "sine", volume: 0.14, delay: 0 },
      { freq: 165, duration: 0.14, type: "sine", volume: 0.1, delay: 0.08 },
    ],
    check: [
      { freq: 620, duration: 0.14, type: "sine", volume: 0.14, delay: 0 },
      { freq: 620, duration: 0.14, type: "sine", volume: 0.14, delay: 0.2 },
    ],
    castle: [
      { freq: 300, duration: 0.11, type: "sine", volume: 0.09, delay: 0 },
      { freq: 380, duration: 0.11, type: "sine", volume: 0.09, delay: 0.11 },
    ],
    promote: [
      { freq: 300, duration: 0.12, type: "sine", volume: 0.11, delay: 0 },
      { freq: 380, duration: 0.12, type: "sine", volume: 0.11, delay: 0.1 },
      { freq: 460, duration: 0.12, type: "sine", volume: 0.11, delay: 0.2 },
      { freq: 620, duration: 0.12, type: "sine", volume: 0.11, delay: 0.3 },
    ],
    gameStart: [
      { freq: 220, duration: 0.14, type: "sine", volume: 0.11, delay: 0 },
      { freq: 300, duration: 0.14, type: "sine", volume: 0.11, delay: 0.12 },
      { freq: 380, duration: 0.14, type: "sine", volume: 0.11, delay: 0.24 },
      { freq: 460, duration: 0.14, type: "sine", volume: 0.11, delay: 0.36 },
    ],
    gameEnd: [
      { freq: 460, duration: 0.16, type: "sine", volume: 0.11, delay: 0 },
      { freq: 380, duration: 0.16, type: "sine", volume: 0.11, delay: 0.14 },
      { freq: 300, duration: 0.16, type: "sine", volume: 0.11, delay: 0.28 },
      { freq: 220, duration: 0.16, type: "sine", volume: 0.11, delay: 0.42 },
      { freq: 165, duration: 0.16, type: "sine", volume: 0.11, delay: 0.56 },
    ],
    draw: [
      { freq: 300, duration: 0.16, type: "sine", volume: 0.11, delay: 0 },
      { freq: 300, duration: 0.16, type: "sine", volume: 0.11, delay: 0.24 },
    ],
    lowTimeTick: [
      { freq: 820, duration: 0.06, type: "sine", volume: 0.08, delay: 0 },
    ],
    brilliant: [
      { freq: 380, duration: 0.12, type: "sine", volume: 0.12, delay: 0 },
      { freq: 480, duration: 0.12, type: "sine", volume: 0.12, delay: 0.1 },
      { freq: 570, duration: 0.14, type: "sine", volume: 0.14, delay: 0.2 },
      { freq: 760, duration: 0.28, type: "sine", volume: 0.16, delay: 0.3 },
    ],
  },
};

class SoundService {
  private ctx: AudioContext | null = null;
  private _enabled = localStorage.getItem(LS_MUTED_KEY) !== "true";
  private _volume = (() => {
    const saved = parseFloat(localStorage.getItem(LS_VOLUME_KEY) ?? "1");
    return Number.isFinite(saved) ? Math.min(1, Math.max(0, saved)) : 1;
  })();

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
      this.ctx.resume().catch((error) => console.warn("Could not resume chess audio.", error));
    }
    return this.ctx;
  }

  private addPitchJitter(baseFreq: number, soundType: keyof SoundProfile = "move"): number {
    if (typeof process !== "undefined" && process.env?.NODE_ENV === "test") {
      return baseFreq;
    }
    const jitterRange = 0.1;
    const jitter = (Math.random() - 0.5) * 2 * jitterRange;

    if (soundType === "capture") {
      return baseFreq * (1 + jitter) * 1.2;
    }
    if (soundType === "check") {
      return baseFreq * (1 + jitter) * 0.8;
    }
    return baseFreq * (1 + jitter);
  }

  private tone(
    freq: number,
    duration: number,
    type: OscType = "sine",
    volume = 0.25,
    delay = 0,
    soundType: keyof SoundProfile = "move",
    endFreq?: number,
  ) {
    if (this._volume === 0) return;
    const ctx = this.getCtx();
    if (!ctx) return;
    let osc: OscillatorNode | null = null;
    let gain: GainNode | null = null;
    try {
      osc = ctx.createOscillator();
      gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      const scaledVolume = volume * this._volume;
      const jitteredFreq = this.addPitchJitter(freq, soundType);

      osc.type = type;
      osc.frequency.setValueAtTime(jitteredFreq, ctx.currentTime + delay);
      if (endFreq !== undefined) {
        osc.frequency.exponentialRampToValueAtTime(endFreq, ctx.currentTime + delay + duration);
      }
      const nodes = [osc, gain];
      osc.onended = () => nodes.forEach((node) => node.disconnect());
      gain.gain.setValueAtTime(0, ctx.currentTime + delay);
      gain.gain.linearRampToValueAtTime(scaledVolume, ctx.currentTime + delay + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + duration);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + duration + 0.05);
    } catch (error) {
      osc?.disconnect();
      gain?.disconnect();
      console.warn("Could not synthesize the chess sound.", error);
    }
  }

  private playSoundEffect(effectKey: keyof SoundProfile, pack: SoundPack = this.getSoundPack()) {
    const profile = SOUND_PROFILES[pack === "metallic" ? "modern-digital" : pack === "default" ? "classic-wood" : pack];
    const tones = profile[effectKey];
    if (pack === "metallic") {
      if (this._volume === 0) return;
      const ctx = this.getCtx();
      if (!ctx) return;
      tones.forEach((tone) => playMetallicTone(ctx, tone.freq, tone.duration, tone.volume * this._volume, tone.delay));
      return;
    }
    tones.forEach((tone) => {
      this.tone(tone.freq, tone.duration, tone.type, tone.volume, tone.delay, effectKey, tone.endFreq);
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

  /** Brilliant move celebratory sound cue */
  brilliant() {
    this.playSoundEffect("brilliant");
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

  /** Alert sound for notifications */
  playAlert() {
    [880, 1100].forEach((f, i) =>
      this.tone(f, 0.15, "sine", 0.30, i * 0.15),
    );
  }

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
    if (!Number.isFinite(value)) return;
    this._volume = Math.min(1, Math.max(0, value));
    localStorage.setItem(LS_VOLUME_KEY, String(this._volume));
  }

  setMasterVolume(value: number) {
    this.setVolume(value);
  }

  getVolume() {
    return this._volume;
  }

  // ── Sound pack ────────────────────────────────────────────────────────────

  setSoundPack(pack: SoundPack) {
    if (isSoundPack(pack)) useThemeStore.getState().setSoundPack(pack);
  }

  getSoundPack(): SoundPack {
    const pack = useThemeStore.getState().soundPack;
    return isSoundPack(pack) ? pack : "wood";
  }

  /**
   * Preview a sound effect (e.g. for audio pack selection in settings).
   */
  previewSound(soundType: "move" | "capture" = "move", pack: SoundPack = this.getSoundPack()) {
    this.playSoundEffect(soundType, isSoundPack(pack) ? pack : this.getSoundPack());
  }

  getAudioContext(): AudioContext | null {
    return this.getCtx();
  }

  playTone(freq: number, duration: number = 0.08, type: OscType = "sine") {
    this.tone(freq, duration, type);
  }

  synthesizeBeep(freq: number = 440, duration: number = 0.08, type: OscType = "sine") {
    this.playTone(freq, duration, type);
  }

  /**
   * Attempts to play an audio element or audio asset URL.
   * If play fails or asset fails to load, gracefully falls back to Web Audio API tone synthesis.
   */
  async playWithFallback(
    audioOrPlayFn: HTMLAudioElement | (() => Promise<void>),
    fallbackFreq: number = 440,
    fallbackDuration: number = 0.08,
    fallbackType: OscType = "sine"
  ) {
    try {
      if (typeof audioOrPlayFn === "function") {
        await audioOrPlayFn();
      } else if (audioOrPlayFn && typeof audioOrPlayFn.play === "function") {
        await audioOrPlayFn.play();
      }
    } catch {
      this.playTone(fallbackFreq, fallbackDuration, fallbackType);
    }
  }
}

export const soundService = new SoundService();

export function getAudioContext(): AudioContext | null {
  return soundService.getAudioContext();
}

export function playTone(freq: number, duration: number = 0.08, type: OscType = "sine") {
  soundService.playTone(freq, duration, type);
}

export function synthesizeBeep(freq: number = 440, duration: number = 0.08, type: OscType = "sine") {
  soundService.synthesizeBeep(freq, duration, type);
}
