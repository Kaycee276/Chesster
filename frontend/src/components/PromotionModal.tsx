interface PromotionModalProps {
	onSelect: (piece: string) => void;
	color: "white" | "black";
}

const PROMOTION_PIECES: Record<string, string> = {
	q: "♛",
	r: "♜",
	b: "♝",
	n: "♞",
};

export default function PromotionModal({
	onSelect,
	color,
}: PromotionModalProps) {
	return (
		<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
			<div className="bg-white/50 p-6 rounded-lg shadow-xl">
				<h3 className="text-xl font-bold mb-4 text-black">
					Choose promotion piece
				</h3>
				<div className="flex gap-4">
					{Object.entries(PROMOTION_PIECES).map(([piece, symbol]) => (
						<button
							key={piece}
							onClick={() => onSelect(piece)}
							className="w-16 h-16 flex items-center justify-center bg-gray-200 hover:bg-gray-300 rounded text-5xl"
						>
							<span className={color === "white" ? "text-white" : "text-black"}>
								{symbol}
							</span>
						</button>
					))}
				</div>
			</div>
		</div>
	);
}
