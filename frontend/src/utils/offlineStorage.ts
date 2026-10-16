/**
 * Offline storage for PWA: IndexedDB wrapper for caching game replays and puzzles.
 * Handles quota exceeded errors, DB unavailability, and bounded storage with eviction.
 */

const DB_NAME = "chesster-offline";
const DB_VERSION = 1;
const REPLAYS_STORE = "replays";
const PUZZLES_STORE = "puzzles";
const MAX_REPLAYS = 10;
const MAX_PUZZLES = 5;

export interface ReplayMetadata {
  gameCode: string;
  pgn: string;
  players?: { white?: string; black?: string };
  result?: string; // "1-0", "0-1", "1/2-1/2"
  endReason?: string;
  timeControl?: string;
  savedAt: number; // timestamp
}

export interface PuzzleData {
  id: string;
  fen: string;
  sideToMove: "white" | "black";
  solution: Array<{ from: [number, number]; to: [number, number]; promotion?: string }>;
  rating: number;
  themes: string[];
  title?: string;
  description?: string;
  savedAt: number; // timestamp
}

export interface OfflineStorageResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Open or create the Chesster offline database.
 */
async function openChessterDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(new Error(`Failed to open IndexedDB: ${request.error}`));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Create replays store
      if (!db.objectStoreNames.contains(REPLAYS_STORE)) {
        db.createObjectStore(REPLAYS_STORE, { keyPath: "gameCode" });
      }

      // Create puzzles store
      if (!db.objectStoreNames.contains(PUZZLES_STORE)) {
        db.createObjectStore(PUZZLES_STORE, { keyPath: "id" });
      }
    };
  });
}

/**
 * Save a game replay to offline storage.
 * If storage quota is exceeded, evict oldest replays and retry once.
 */
export async function saveGameToOfflineCache(
  replay: ReplayMetadata,
): Promise<OfflineStorageResult<void>> {
  try {
    const db = await openChessterDB();
    const tx = db.transaction([REPLAYS_STORE], "readwrite");
    const store = tx.objectStore(REPLAYS_STORE);

    return new Promise((resolve) => {
      const putRequest = store.put(replay);

      putRequest.onsuccess = () => {
        tx.oncomplete = () => {
          resolve({ success: true });
        };
      };

      putRequest.onerror = async (event) => {
        const error = (event.target as IDBRequest).error;
        if (error?.name === "QuotaExceededError") {
          // Evict oldest replay and retry
          const evictResult = await evictOldestReplays(1);
          if (evictResult) {
            const retryResult = await saveGameToOfflineCache(replay);
            resolve(retryResult);
          } else {
            resolve({
              success: false,
              error: "Storage quota exceeded and could not evict old data",
            });
          }
        } else {
          resolve({
            success: false,
            error: `Failed to save replay: ${error?.message || "unknown error"}`,
          });
        }
      };

      tx.onerror = () => {
        resolve({
          success: false,
          error: `Transaction failed: ${tx.error?.message || "unknown error"}`,
        });
      };
    });
  } catch (err) {
    // IndexedDB unavailable (private mode, blocked, etc.)
    return {
      success: false,
      error: `IndexedDB unavailable: ${err instanceof Error ? err.message : "unknown error"}`,
    };
  }
}

/**
 * Retrieve a cached game replay by code.
 */
export async function getOfflineGame(
  gameCode: string,
): Promise<OfflineStorageResult<ReplayMetadata>> {
  try {
    const db = await openChessterDB();
    const tx = db.transaction([REPLAYS_STORE], "readonly");
    const store = tx.objectStore(REPLAYS_STORE);

    return new Promise((resolve) => {
      const request = store.get(gameCode);

      request.onsuccess = () => {
        const replay = request.result as ReplayMetadata | undefined;
        if (replay) {
          resolve({ success: true, data: replay });
        } else {
          resolve({ success: false, error: "Game not found in cache" });
        }
      };

      request.onerror = () => {
        resolve({
          success: false,
          error: `Failed to retrieve game: ${request.error?.message || "unknown error"}`,
        });
      };
    });
  } catch (err) {
    return {
      success: false,
      error: `IndexedDB unavailable: ${err instanceof Error ? err.message : "unknown error"}`,
    };
  }
}

/**
 * List all cached replays, ordered by most recent first.
 */
export async function listOfflineGames(): Promise<OfflineStorageResult<ReplayMetadata[]>> {
  try {
    const db = await openChessterDB();
    const tx = db.transaction([REPLAYS_STORE], "readonly");
    const store = tx.objectStore(REPLAYS_STORE);

    return new Promise((resolve) => {
      const request = store.getAll();

      request.onsuccess = () => {
        const replays = (request.result as ReplayMetadata[]).sort(
          (a, b) => b.savedAt - a.savedAt,
        );
        resolve({ success: true, data: replays });
      };

      request.onerror = () => {
        resolve({
          success: false,
          error: `Failed to list games: ${request.error?.message || "unknown error"}`,
        });
      };
    });
  } catch (err) {
    return {
      success: false,
      error: `IndexedDB unavailable: ${err instanceof Error ? err.message : "unknown error"}`,
    };
  }
}

/**
 * Save a puzzle to offline storage.
 * Prunes oldest puzzles if exceeding MAX_PUZZLES.
 */
export async function savePuzzleToOfflineCache(
  puzzle: PuzzleData,
): Promise<OfflineStorageResult<void>> {
  try {
    const db = await openChessterDB();
    const tx = db.transaction([PUZZLES_STORE], "readwrite");
    const store = tx.objectStore(PUZZLES_STORE);

    return new Promise((resolve) => {
      const putRequest = store.put(puzzle);

      putRequest.onsuccess = () => {
        // Check if we need to prune
        const getAllRequest = store.getAll();
        getAllRequest.onsuccess = async () => {
          const allPuzzles = getAllRequest.result as PuzzleData[];
          if (allPuzzles.length > MAX_PUZZLES) {
            const sorted = allPuzzles.sort((a, b) => a.savedAt - b.savedAt);
            const toDelete = sorted.slice(0, allPuzzles.length - MAX_PUZZLES);
            for (const puz of toDelete) {
              store.delete(puz.id);
            }
          }

          tx.oncomplete = () => {
            resolve({ success: true });
          };
        };
      };

      putRequest.onerror = async (event) => {
        const error = (event.target as IDBRequest).error;
        if (error?.name === "QuotaExceededError") {
          // Evict oldest puzzle and retry
          const evictResult = await evictOldestPuzzles(1);
          if (evictResult) {
            const retryResult = await savePuzzleToOfflineCache(puzzle);
            resolve(retryResult);
          } else {
            resolve({
              success: false,
              error: "Storage quota exceeded and could not evict old data",
            });
          }
        } else {
          resolve({
            success: false,
            error: `Failed to save puzzle: ${error?.message || "unknown error"}`,
          });
        }
      };

      tx.onerror = () => {
        resolve({
          success: false,
          error: `Transaction failed: ${tx.error?.message || "unknown error"}`,
        });
      };
    });
  } catch (err) {
    return {
      success: false,
      error: `IndexedDB unavailable: ${err instanceof Error ? err.message : "unknown error"}`,
    };
  }
}

/**
 * Retrieve a cached puzzle by id.
 */
export async function getOfflinePuzzle(
  puzzleId: string,
): Promise<OfflineStorageResult<PuzzleData>> {
  try {
    const db = await openChessterDB();
    const tx = db.transaction([PUZZLES_STORE], "readonly");
    const store = tx.objectStore(PUZZLES_STORE);

    return new Promise((resolve) => {
      const request = store.get(puzzleId);

      request.onsuccess = () => {
        const puzzle = request.result as PuzzleData | undefined;
        if (puzzle) {
          resolve({ success: true, data: puzzle });
        } else {
          resolve({ success: false, error: "Puzzle not found in cache" });
        }
      };

      request.onerror = () => {
        resolve({
          success: false,
          error: `Failed to retrieve puzzle: ${request.error?.message || "unknown error"}`,
        });
      };
    });
  } catch (err) {
    return {
      success: false,
      error: `IndexedDB unavailable: ${err instanceof Error ? err.message : "unknown error"}`,
    };
  }
}

/**
 * Retrieve the most recent cached puzzle.
 */
export async function getLatestOfflinePuzzle(): Promise<OfflineStorageResult<PuzzleData>> {
  try {
    const db = await openChessterDB();
    const tx = db.transaction([PUZZLES_STORE], "readonly");
    const store = tx.objectStore(PUZZLES_STORE);

    return new Promise((resolve) => {
      const request = store.getAll();

      request.onsuccess = () => {
        const puzzles = (request.result as PuzzleData[]).sort((a, b) => b.savedAt - a.savedAt);
        if (puzzles.length > 0) {
          resolve({ success: true, data: puzzles[0] });
        } else {
          resolve({ success: false, error: "No puzzles in cache" });
        }
      };

      request.onerror = () => {
        resolve({
          success: false,
          error: `Failed to retrieve puzzles: ${request.error?.message || "unknown error"}`,
        });
      };
    });
  } catch (err) {
    return {
      success: false,
      error: `IndexedDB unavailable: ${err instanceof Error ? err.message : "unknown error"}`,
    };
  }
}

/**
 * Evict the oldest N replays from storage.
 */
async function evictOldestReplays(count: number): Promise<boolean> {
  try {
    const db = await openChessterDB();
    const tx = db.transaction([REPLAYS_STORE], "readwrite");
    const store = tx.objectStore(REPLAYS_STORE);

    return new Promise((resolve) => {
      const request = store.getAll();

      request.onsuccess = () => {
        const replays = (request.result as ReplayMetadata[]).sort(
          (a, b) => a.savedAt - b.savedAt,
        );
        const toDelete = replays.slice(0, count);
        for (const replay of toDelete) {
          store.delete(replay.gameCode);
        }

        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      };

      request.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

/**
 * Evict the oldest N puzzles from storage.
 */
async function evictOldestPuzzles(count: number): Promise<boolean> {
  try {
    const db = await openChessterDB();
    const tx = db.transaction([PUZZLES_STORE], "readwrite");
    const store = tx.objectStore(PUZZLES_STORE);

    return new Promise((resolve) => {
      const request = store.getAll();

      request.onsuccess = () => {
        const puzzles = (request.result as PuzzleData[]).sort((a, b) => a.savedAt - b.savedAt);
        const toDelete = puzzles.slice(0, count);
        for (const puzzle of toDelete) {
          store.delete(puzzle.id);
        }

        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      };

      request.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}
