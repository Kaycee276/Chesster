import { useRef, useEffect } from "react";
import { X } from "lucide-react";
import { useFocusTrap } from "../hooks/useFocusTrap";

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
  triggerElement?: HTMLElement | null;
}

export default function KeyboardShortcutsModal({
  isOpen,
  onClose,
  triggerElement,
}: KeyboardShortcutsModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Wire the focus trap
  useFocusTrap(dialogRef, isOpen);

  // Handle Escape key to close
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        className="w-full max-w-sm bg-(--bg-secondary) border border-(--border) rounded-2xl p-6 flex flex-col gap-5 shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2
            id="shortcuts-title"
            className="text-base font-bold"
          >
            Keyboard Shortcuts
          </h2>
          <button
            onClick={onClose}
            aria-label="Close shortcuts"
            className="text-(--text-tertiary) hover:text-(--text) transition-colors text-lg leading-none"
          >
            <X size={16} />
          </button>
        </div>

        {/* Help section */}
        <section>
          <h3 className="text-sm font-semibold text-(--text-secondary) mb-3">
            General
          </h3>
          <dl className="space-y-2 text-sm">
            <div className="flex gap-3">
              <dt>
                <kbd className="px-2 py-1 bg-(--bg-tertiary) border border-(--border) rounded text-xs font-mono">
                  ?
                </kbd>
              </dt>
              <dd className="text-(--text-secondary) flex-1">Open this help</dd>
            </div>
            <div className="flex gap-3">
              <dt>
                <kbd className="px-2 py-1 bg-(--bg-tertiary) border border-(--border) rounded text-xs font-mono">
                  Esc
                </kbd>
              </dt>
              <dd className="text-(--text-secondary) flex-1">Close modals and dialogs</dd>
            </div>
          </dl>
        </section>

        {/* Board navigation section */}
        <section className="pt-3 border-t border-(--border)">
          <h3 className="text-sm font-semibold text-(--text-secondary) mb-3">
            Board Navigation
          </h3>
          <p className="text-xs text-(--text-tertiary) mb-3">
            Keyboard navigation for the chess board is planned for a future release.
          </p>
        </section>

        {/* Additional features section */}
        <section className="pt-3 border-t border-(--border)">
          <h3 className="text-sm font-semibold text-(--text-secondary) mb-3">
            Features
          </h3>
          <p className="text-xs text-(--text-tertiary) mb-3">
            Additional keyboard shortcuts for game controls (clock, chat, analysis) are coming soon.
          </p>
        </section>

        {/* Footer tip */}
        <div className="pt-3 border-t border-(--border)">
          <p className="text-xs text-(--text-tertiary)">
            💡 Tip: Press <kbd className="px-1 bg-(--bg-tertiary) rounded">Tab</kbd> to navigate
            this dialog with your keyboard.
          </p>
        </div>
      </div>
    </div>
  );
}
