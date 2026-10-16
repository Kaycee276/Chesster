import { useEffect, useRef } from "react";

/**
 * useFocusTrap: A keyboard focus trap for modals and dialogs.
 *
 * When active, Tab and Shift+Tab cycle through focusable elements within
 * the container. Focus is restored to the element that had focus before
 * the trap activated when it is deactivated or the component unmounts.
 *
 * @param ref - Reference to the container element
 * @param isActive - Whether the trap is currently active
 */
export function useFocusTrap(ref: React.RefObject<HTMLElement>, isActive: boolean): void {
  const priorElement = useRef<HTMLElement | null>(null);

  /**
   * Get all focusable elements within the container.
   * Computed at runtime to support dynamic content.
   */
  const getFocusableElements = (): HTMLElement[] => {
    if (!ref.current) return [];

    const selector =
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const elements = Array.from(ref.current.querySelectorAll(selector));

    return elements.filter((el) => {
      const elem = el as HTMLElement;
      // Exclude disabled, hidden, aria-hidden, or display:none elements
      if (
        (elem as any).disabled ||
        (elem as any).hidden ||
        elem.getAttribute("aria-hidden") === "true"
      ) {
        return false;
      }

      const style = window.getComputedStyle(elem);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.visibility === "collapse"
      ) {
        return false;
      }

      return true;
    }) as HTMLElement[];
  };

  useEffect(() => {
    const container = ref.current;
    if (!container) return;

    if (!isActive) {
      // Deactivation: restore focus to prior element
      if (priorElement.current && document.contains(priorElement.current)) {
        priorElement.current.focus();
      }
      priorElement.current = null;
      return;
    }

    // Activation: save prior focus and move focus into container
    priorElement.current = (document.activeElement as HTMLElement) || null;

    const focusables = getFocusableElements();

    if (focusables.length === 0) {
      // No focusable elements: make container itself focusable
      container.setAttribute("tabindex", "-1");
      container.focus();
    } else {
      // Focus first focusable element
      focusables[0].focus();
    }

    // Handle Tab and Shift+Tab
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;

      const focusables = getFocusableElements();
      if (focusables.length === 0) {
        // No focusables: keep focus on container
        e.preventDefault();
        if (container.getAttribute("tabindex") === null) {
          container.setAttribute("tabindex", "-1");
        }
        container.focus();
        return;
      }

      const focusedIndex = focusables.indexOf(document.activeElement as HTMLElement);

      if (e.shiftKey) {
        // Shift+Tab: move backward
        if (focusedIndex <= 0) {
          e.preventDefault();
          focusables[focusables.length - 1].focus();
        }
      } else {
        // Tab: move forward
        if (focusedIndex >= focusables.length - 1) {
          e.preventDefault();
          focusables[0].focus();
        }
      }
    };

    container.addEventListener("keydown", handleKeyDown);

    return () => {
      container.removeEventListener("keydown", handleKeyDown);
      // Remove temporary tabindex if we added it
      if (
        container.getAttribute("tabindex") === "-1" &&
        getFocusableElements().length === 0
      ) {
        container.removeAttribute("tabindex");
      }
    };
  }, [isActive]);
}
