import { useEffect } from "react";
import { savePuzzleToOfflineCache, getLatestOfflinePuzzle } from "../utils/offlineStorage";
import type { Puzzle } from "../api/puzzleApi";

/**
 * Hook to cache puzzle data and manage offline puzzle access.
 */
export function usePuzzleCache() {
  const cachePuzzle = async (puzzle: Puzzle): Promise<void> => {
    const result = await savePuzzleToOfflineCache({
      id: puzzle.id,
      fen: puzzle.fen,
      sideToMove: puzzle.sideToMove,
      solution: puzzle.solution,
      rating: puzzle.rating,
      themes: puzzle.themes,
      title: puzzle.title,
      description: puzzle.description,
      savedAt: Date.now(),
    });

    if (!result.success) {
      console.warn("Failed to cache puzzle:", result.error);
    }
  };

  const getOfflinePuzzle = getLatestOfflinePuzzle;

  return { cachePuzzle, getOfflinePuzzle };
}
