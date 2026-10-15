/**
 * Trigger subtle haptic vibration feedback on supported devices (#439).
 */
export function triggerHaptic(type: "pickup" | "drop" | "error"): void {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    try {
      if (type === "pickup") navigator.vibrate(10);
      else if (type === "drop") navigator.vibrate(25);
      else if (type === "error") navigator.vibrate([40, 30, 40]);
    } catch {
      // Haptics unavailable or permission denied
    }
  }
}
