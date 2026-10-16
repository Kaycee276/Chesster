import { useRef } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";

interface PromotionModalProps {
	onSelect: (piece: string) => void;
	color: "white" | "black";
}

// White player sees hollow symbols, black player sees filled symbols
const PROMOTION_PIECES: Record<"white" | "black", Record<string, string>> = {
	white: { q: "♕", r: "♖", b: "♗", n: "♘" },
	black: { q: "♛", r: "♜", b: "♝", n: "♞" },
};

const WHITE_PIECE_STYLE: React.CSSProperties = {
	color: "#ffffff",
	textShadow:
		"-1.5px -1.5px 0 #000, 1.5px -1.5px 0 #000, -1.5px 1.5px 0 #000, 1.5px 1.5px 0 #000",
	WebkitTextStroke: "0.5px #000",
};

const BLACK_PIECE_STYLE: React.CSSProperties = {
	color: "#111111",
	textShadow:
		"-1.5px -1.5px 0 #fff, 1.5px -1.5px 0 #fff, -1.5px 1.5px 0 #fff, 1.5px 1.5px 0 #fff",
	WebkitTextStroke: "0.5px #fff",
};

export default function PromotionModal({
	onSelect,
	color,
}: PromotionModalProps) {
	const dialogRef = useRef<HTMLDivElement>(null);
	useFocusTrap(dialogRef, true);

	const pieces = PROMOTION_PIECES[color];
	const pieceStyle = color === "white" ? WHITE_PIECE_STYLE : BLACK_PIECE_STYLE;

	return (
		<div
			className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center"
			onClick={() => {}} // Prevents accidental close
		>
			<div
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby="promotion-title"
				className="bg-white/50 p-6 rounded-lg shadow-xl"
				onClick={(e) => e.stopPropagation()}
			>
				<h3 id="promotion-title" className="text-xl font-bold mb-4 text-black">
					Choose promotion piece
				</h3>
				<div className="flex gap-4">
					{Object.entries(pieces).map(([piece, symbol]) => (
						<button
							key={piece}
							onClick={() => onSelect(piece)}
							aria-label={`Promote to ${piece.toUpperCase()}`}
							className="w-16 h-16 flex items-center justify-center bg-gray-200 hover:bg-gray-300 rounded text-5xl"
						>
							<span style={pieceStyle}>{symbol}</span>
						</button>
					))}
				</div>
			</div>
		</div>
	);
}
