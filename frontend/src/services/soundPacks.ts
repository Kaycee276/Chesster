export type SoundPack =
  | "default" | "wood" | "retro" | "metallic"
  | "plastic" | "arcade" | "classic-wood" | "modern-digital" | "lofi-soft";

export const SOUND_PACKS: ReadonlyArray<{ key: SoundPack; name: string; description: string }> = [
  { key: "wood", name: "Wood", description: "Soft triangle-wave wooden board impacts" },
  { key: "retro", name: "Retro 8-Bit", description: "Square-wave chiptune arpeggios" },
  { key: "metallic", name: "Modern Metallic", description: "Filtered noise and bright metal resonance" },
  { key: "default", name: "Default", description: "The original mellow chess tones" },
  { key: "plastic", name: "Plastic", description: "Modern plastic piece sounds" },
  { key: "arcade", name: "Arcade", description: "Retro arcade synth sounds" },
  { key: "classic-wood", name: "Classic Wood", description: "Warm mellow woody tones" },
  { key: "modern-digital", name: "Modern Digital", description: "Crisp synthesized digital sounds" },
  { key: "lofi-soft", name: "Low-Fi Soft", description: "Muted subtle organic tones" },
];

export function isSoundPack(value: unknown): value is SoundPack {
  return SOUND_PACKS.some((pack) => pack.key === value);
}

export function readLegacySoundPack(): SoundPack {
  try {
    const value = localStorage.getItem("chesster_sound_pack");
    return isSoundPack(value) ? value : "wood";
  } catch {
    return "wood";
  }
}

export function saveLegacySoundPack(pack: SoundPack): void {
  try {
    localStorage.setItem("chesster_sound_pack", pack);
  } catch (error) {
    console.warn("Could not save the sound pack preference.", error);
  }
}
