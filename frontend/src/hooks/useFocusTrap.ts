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
export function useFocusTrap(ref: React.RefObject<HTMLElement | null>, isActive: boolean): void {
  const priorElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;

    const getFocusableElements = (): HTMLElement[] => {
      const selector =
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
      const elements = Array.from(container.querySelectorAll(selector));

      return elements.filter((el) => {
        const elem = el as HTMLElement;
        if (
          ("disabled" in elem && Boolean((elem as unknown as { disabled?: boolean }).disabled)) ||
          elem.hidden ||
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

      const currentFocusables = getFocusableElements();
      if (currentFocusables.length === 0) {
        // No focusables: keep focus on container
        e.preventDefault();
        if (container.getAttribute("tabindex") === null) {
          container.setAttribute("tabindex", "-1");
        }
        container.focus();
        return;
      }

      const focusedIndex = currentFocusables.indexOf(document.activeElement as HTMLElement);

      if (e.shiftKey) {
        // Shift+Tab: move backward
        e.preventDefault();
        if (focusedIndex <= 0) {
          currentFocusables[currentFocusables.length - 1].focus();
        } else {
          currentFocusables[focusedIndex - 1].focus();
        }
      } else {
        // Tab: move forward
        e.preventDefault();
        if (focusedIndex >= currentFocusables.length - 1 || focusedIndex === -1) {
          currentFocusables[0].focus();
        } else {
          currentFocusables[focusedIndex + 1].focus();
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
  }, [isActive, ref]);
}
