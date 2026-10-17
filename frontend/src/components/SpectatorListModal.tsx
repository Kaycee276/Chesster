import { useRef, useEffect } from "react";
import { X } from "lucide-react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { truncateWallet } from "../utils/truncateWallet";

interface SpectatorListModalProps {
  isOpen: boolean;
  onClose: () => void;
  triggerElement?: HTMLElement | null;
  spectatorCount: number;
  spectatorList: Array<{ address: string; username?: string | null }>;
}

export default function SpectatorListModal({
  isOpen,
  onClose,
  spectatorCount,
  spectatorList,
}: SpectatorListModalProps) {
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

  const hasSpectators = spectatorList && spectatorList.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="spectator-modal-title"
        className="w-full max-w-sm bg-(--bg-secondary) border border-(--border) rounded-2xl p-6 flex flex-col gap-4 shadow-2xl max-h-[70vh] overflow-hidden flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between shrink-0">
          <h2
            id="spectator-modal-title"
            className="text-base font-bold"
          >
            Spectators
          </h2>
          <button
            onClick={onClose}
            aria-label="Close spectators list"
            className="text-(--text-tertiary) hover:text-(--text) transition-colors text-lg leading-none"
          >
            <X size={16} />
          </button>
        </div>

        {/* Spectator count display */}
        <div className="text-sm text-(--text-secondary)">
          {spectatorCount === 1
            ? "1 spectator watching"
            : `${spectatorCount} spectators watching`}
        </div>

        {/* Spectator list */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {!hasSpectators ? (
            <div className="text-sm text-(--text-tertiary) py-4 text-center">
              No spectators right now
            </div>
          ) : (
            <ul className="space-y-2">
              {spectatorList.map((spectator, idx) => {
                const displayName =
                  spectator.username || truncateWallet(spectator.address);

                return (
                  <li
                    key={`${spectator.address}-${idx}`}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-(--bg-tertiary) text-sm text-(--text-secondary)"
                  >
                    <div className="w-1.5 h-1.5 rounded-full bg-(--accent-primary) shrink-0" />
                    <span className="truncate">{displayName}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
