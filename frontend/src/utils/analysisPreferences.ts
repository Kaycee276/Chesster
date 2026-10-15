const STORAGE_KEY = "chesster_analysis_preferences";

export interface AnalysisPreferences {
  targetDepth: number;
  multiPv: number;
  isPaused: boolean;
}

export function loadAnalysisPreferences(): AnalysisPreferences {
  if (typeof window === "undefined" || !window.localStorage) {
    return { targetDepth: 16, multiPv: 1, isPaused: false };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        targetDepth: Math.max(10, Math.min(24, Number(parsed.targetDepth) || 16)),
        multiPv: Math.max(1, Math.min(3, Number(parsed.multiPv) || 1)),
        isPaused: Boolean(parsed.isPaused),
      };
    }
  } catch {
    // ignore json parse error
  }
  return { targetDepth: 16, multiPv: 1, isPaused: false };
}

export function saveAnalysisPreferences(prefs: Partial<AnalysisPreferences>): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const current = loadAnalysisPreferences();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...prefs }));
  } catch {
    // ignore storage quota error
  }
}
