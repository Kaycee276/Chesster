import { useSyncExternalStore } from "react";

function subscribe(change: () => void) {
  window.addEventListener("online", change);
  window.addEventListener("offline", change);
  return () => {
    window.removeEventListener("online", change);
    window.removeEventListener("offline", change);
  };
}

/** Browser connectivity changes select local routes before online pages mount. */
export function useOfflineDetection(): boolean {
  return useSyncExternalStore(subscribe, () => !navigator.onLine, () => false);
}
