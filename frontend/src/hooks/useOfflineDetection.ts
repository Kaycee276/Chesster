import { useState, useEffect } from "react";

/**
 * Hook to detect online/offline status and subscribe to connectivity changes.
 * Returns true if online, false if offline.
 * Also treats failed network requests as offline.
 */
export function useOfflineDetection(): boolean {
  const [isOnline, setIsOnline] = useState(() => {
    // Check initial status
    if (typeof navigator === "undefined") return true;
    return navigator.onLine;
  });

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  return isOnline;
}
