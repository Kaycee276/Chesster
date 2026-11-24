const STORAGE_KEY = "chesster_analysis_preferences";

export interface EngineSettings {
  maxDepth: number; // 10 - 25, default 18
  threads: number; // 1 - 4, default 1
  hashSizeMb: number; // 16, 32, 64, default 16
}

export function applyEngineOptions(
  worker: { postMessage(cmd: string): void },
  settings: EngineSettings
): void {
  worker.postMessage(`setoption name Threads value ${settings.threads}`);
  worker.postMessage(`setoption name Hash value ${settings.hashSizeMb}`);
}

export interface AnalysisPreferences {
  targetDepth: number;
  maxDepth?: number;
  threads: number;
  hashSizeMb: number;
  multiPv: number;
  isPaused: boolean;
  lockWhiteBottom?: boolean;
}

export function loadAnalysisPreferences(): AnalysisPreferences {
  if (typeof window === "undefined" || !window.localStorage) {
    return {
      targetDepth: 18,
      maxDepth: 18,
      threads: 1,
      hashSizeMb: 16,
      multiPv: 1,
      isPaused: false,
      lockWhiteBottom: false,
    };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const depth = Math.max(
        10,
        Math.min(25, Number(parsed.targetDepth || parsed.maxDepth) || 18)
      );
      return {
        targetDepth: depth,
        maxDepth: depth,
        threads: Math.max(1, Math.min(4, Number(parsed.threads) || 1)),
        hashSizeMb: [16, 32, 64].includes(Number(parsed.hashSizeMb))
          ? Number(parsed.hashSizeMb)
          : 16,
        multiPv: Math.max(1, Math.min(3, Number(parsed.multiPv) || 1)),
        isPaused: Boolean(parsed.isPaused),
        lockWhiteBottom: Boolean(parsed.lockWhiteBottom),
      };
    }
  } catch {
    // ignore json parse error
  }
  return {
    targetDepth: 18,
    maxDepth: 18,
    threads: 1,
    hashSizeMb: 16,
    multiPv: 1,
    isPaused: false,
    lockWhiteBottom: false,
  };
}

export function saveAnalysisPreferences(
  prefs: Partial<AnalysisPreferences>
): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const current = loadAnalysisPreferences();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...prefs }));
  } catch {
    // ignore storage quota error
  }
}
