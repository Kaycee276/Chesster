import { useEffect, useId, useRef } from "react";
import { PIECE_NAMES } from "../utils/boardA11y";

interface PromotionModalProps {
  onSelect: (piece: string) => void;
  onCancel?: () => void;
  color: "white" | "black";
}

const PROMOTION_PIECES: Record<"white" | "black", Record<string, string>> = {
  white: { q: "♕", r: "♖", b: "♗", n: "♘" },
  black: { q: "♛", r: "♜", b: "♝", n: "♞" },
};
const WHITE_PIECE_STYLE: React.CSSProperties = {
  color: "#ffffff",
  textShadow: "-1.5px -1.5px 0 #000, 1.5px -1.5px 0 #000, -1.5px 1.5px 0 #000, 1.5px 1.5px 0 #000",
  WebkitTextStroke: "0.5px #000",
};
const BLACK_PIECE_STYLE: React.CSSProperties = {
  color: "#111111",
  textShadow: "-1.5px -1.5px 0 #fff, 1.5px -1.5px 0 #fff, -1.5px 1.5px 0 #fff, 1.5px 1.5px 0 #fff",
  WebkitTextStroke: "0.5px #fff",
};

export default function PromotionModal({ onSelect, onCancel, color }: PromotionModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const pieces = PROMOTION_PIECES[color];
  const pieceStyle = color === "white" ? WHITE_PIECE_STYLE : BLACK_PIECE_STYLE;
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => { if (previousFocus?.isConnected) previousFocus.focus(); };
  }, []);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className="bg-white/50 p-6 rounded-lg shadow-xl"
        onKeyDown={event => {
          event.stopPropagation();
          const key = event.key.toLowerCase();
          if (event.ctrlKey || event.metaKey || event.altKey) return;
          if (event.key === "Escape" && onCancel) {
            event.preventDefault();
            onCancel();
          } else if (Object.hasOwn(pieces, key)) {
            event.preventDefault();
            onSelect(key);
          } else if (event.key === "Tab") {
            const buttons = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            if ((event.shiftKey && index <= 0) || (!event.shiftKey && index === buttons.length - 1)) {
              event.preventDefault();
              buttons[event.shiftKey ? buttons.length - 1 : 0]?.focus();
            }
          }
        }}
      >
        <h3 id={titleId} className="text-xl font-bold mb-4 text-black">Choose promotion piece</h3>
        <div className="flex gap-4">
          {Object.entries(pieces).map(([piece, symbol]) => (
            <button key={piece} type="button" aria-label={`${color} ${PIECE_NAMES[piece]}`}
              onClick={() => onSelect(piece)}
              className="w-16 h-16 flex items-center justify-center bg-gray-200 hover:bg-gray-300 rounded text-5xl focus-visible:outline-2 focus-visible:outline-blue-700"
            >
              <span aria-hidden="true" style={pieceStyle}>{symbol}</span>
            </button>
          ))}
        </div>
        {onCancel && <button type="button" className="mt-4 underline text-black" onClick={onCancel}>Cancel promotion</button>}
      </div>
    </div>
  );
}
