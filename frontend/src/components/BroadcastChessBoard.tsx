type BoardTheme = "neon" | "wood" | "glass";

interface BroadcastChessBoardProps {
	board: string[][];
	orientation: "white" | "black";
	theme: BoardTheme;
}

const PIECES: Record<string, string> = {
	K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙",
	k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟",
};

const SQUARE_COLORS: Record<BoardTheme, { light: string; dark: string }> = {
	neon: { light: "#263858", dark: "#101827" },
	wood: { light: "#d8ad78", dark: "#795238" },
	glass: { light: "rgba(203,213,225,.72)", dark: "rgba(51,65,85,.82)" },
};

export default function BroadcastChessBoard({ board, orientation, theme }: BroadcastChessBoardProps) {
	if (board.length !== 8 || board.some((row) => row.length !== 8)) {
		return <div role="status" className="aspect-square w-full rounded-lg bg-black/20" aria-label="Waiting for the board position" />;
	}

	const rows = orientation === "black" ? [...board].reverse().map((row) => [...row].reverse()) : board;
	const colors = SQUARE_COLORS[theme];

	return (
		<div
			role="grid"
			aria-label={`Chess board, viewed from ${orientation}'s side`}
			className="grid aspect-square w-full overflow-hidden rounded-lg shadow-2xl"
			style={{ gridTemplateColumns: "repeat(8, minmax(0, 1fr))", gridTemplateRows: "repeat(8, minmax(0, 1fr))" }}
		>
			{rows.flatMap((row, rowIndex) =>
				row.map((piece, columnIndex) => {
					const isLight = (rowIndex + columnIndex) % 2 === 0;
					const isWhitePiece = piece !== "." && piece === piece.toUpperCase();
					return (
						<div
							key={`${rowIndex}-${columnIndex}`}
							role="gridcell"
							aria-label={piece === "." ? "Empty square" : `${isWhitePiece ? "White" : "Black"} ${piece.toLowerCase()}`}
							className="flex items-center justify-center select-none text-[clamp(1.5rem,8vw,6rem)] leading-none"
							style={{ backgroundColor: isLight ? colors.light : colors.dark }}
						>
							{PIECES[piece] ?? ""}
						</div>
					);
				}),
			)}
		</div>
	);
}
