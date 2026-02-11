import { useGameStore } from "../store/gameStore";
import { useToastStore } from "../store/toastStore";
import { Copy, Check, LogOut } from "lucide-react";
import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { getPossibleMoves } from "../utils/chessUtils";

const PIECE_SYMBOLS: Record<string, string> = {
	K: "♚",
	Q: "♛",
	R: "♜",
	B: "♝",
	N: "♞",
	P: "♟",
	k: "♚",
	q: "♛",
	r: "♜",
	b: "♝",
	n: "♞",
	p: "♟",
};

export default function ChessBoard() {
	const {
		board,
		gameCode,
		playerColor,
		currentTurn,
		status,
		selectedSquare,
		makeMove,
		selectSquare,
		leaveGame,
		// fetchGameState,
	} = useGameStore();
	const { addToast } = useToastStore();
	const navigate = useNavigate();

	const [copied, setCopied] = useState(false);

	const possibleMoves = useMemo(() => {
		if (!selectedSquare || !playerColor) return [];
		return getPossibleMoves(board, selectedSquare, playerColor);
	}, [selectedSquare, board, playerColor]);

	const isPossibleMove = (row: number, col: number) =>
		possibleMoves.some(([r, c]) => r === row && c === col);

	const handleLeaveGame = () => {
		leaveGame();
		navigate("/");
	};

	const copyGameCode = async () => {
		if (!gameCode) return;

		await navigator.clipboard.writeText(gameCode);
		setCopied(true);
		setTimeout(() => setCopied(false), 1200);
	};

	const handleSquareClick = async (row: number, col: number) => {
		if (status !== "active" || currentTurn !== playerColor) return;

		if (!selectedSquare) {
			const piece = board[row][col];
			if (piece === ".") return;
			const isWhitePiece = piece === piece.toUpperCase();
			if (
				(playerColor === "white" && !isWhitePiece) ||
				(playerColor === "black" && isWhitePiece)
			)
				return;
			selectSquare([row, col]);
		} else {
			try {
				await makeMove(selectedSquare, [row, col]);
			} catch (error: unknown) {
				if (error instanceof Error) {
					addToast(error.message);
				} else {
					addToast("Something went wrong");
				}
				selectSquare(null);
			}
		}
	};

	const isSelected = (row: number, col: number) =>
		selectedSquare && selectedSquare[0] === row && selectedSquare[1] === col;

	return (
		<div className="flex flex-col items-center gap-4 p-4 min-h-screen">
			<div className="flex items-center justify-center gap-4 text-xs h-10 px-10 rounded">
				<button
					onClick={handleLeaveGame}
					className="px-3 py-1 bg-(--accent-dark) hover:bg-(--accent-primary) rounded flex items-center gap-2"
					title="Leave game"
				>
					<LogOut size={14} />
					Leave
				</button>
				<span className="flex flex-col items-center gap-1">
					<h6 className="text-(--accent-primary)">Game Code</h6>

					<span className="flex items-center gap-2 font-mono">
						<button
							onClick={copyGameCode}
							title="Copy game code"
							disabled={!gameCode}
						>
							{copied ? <Check size={14} /> : <Copy size={14} />}
						</button>
						<span>{gameCode}</span>
					</span>
				</span>

				<span className="flex flex-col items-center gap-1">
					<h6 className="text-(--accent-primary)">Player Color</h6>

					<span className="flex items-center gap-2">
						<span>{playerColor}</span>
					</span>
				</span>

				<span className="flex flex-col items-center gap-1">
					<h6 className="text-(--accent-primary)">Turn</h6>

					<span className="flex items-center gap-2">
						<span className="uppercase">{currentTurn}</span>
					</span>
				</span>

				<span className="flex flex-col items-center gap-1">
					<h6 className="text-(--accent-primary)">Status</h6>
					<span className="flex items-center gap-2">
						<span>{status}</span>
					</span>
				</span>

				{/* <button
					onClick={fetchGameState}
					className="ml-2 p-1 bg-(--accent-dark) hover:bg-(--accent-primary) rounded"
				>
					Refresh
				</button> */}
			</div>

			<div className="max-w-full">
				{board.map((row, rowIndex) => (
					<div key={rowIndex} className="flex">
						{row.map((piece, colIndex) => {
							const isLight = (rowIndex + colIndex) % 2 === 0;
							return (
								<div
									key={`${rowIndex}-${colIndex}`}
									className={`w-17.5 h-17.5 flex items-center justify-center cursor-pointer transition-opacity hover:opacity-80 relative ${
										isLight ? "bg-(--accent-light)/90" : "bg-(--accent-dark)"
									} ${isSelected(rowIndex, colIndex) ? "bg-(--success) shadow-inner" : ""}`}
									onClick={() => handleSquareClick(rowIndex, colIndex)}
								>
									{isPossibleMove(rowIndex, colIndex) && (
										<div className="absolute w-3 h-3 bg-(--info) rounded-full opacity-70" />
									)}
									{piece !== "." && (
										<span
											className={`text-5xl select-none ${piece === piece.toUpperCase() ? "text-white" : "text-black"}`}
										>
											{PIECE_SYMBOLS[piece]}
										</span>
									)}
								</div>
							);
						})}
					</div>
				))}
			</div>
		</div>
	);
}
