import { useGameStore, useGameNotifications } from "../store/gameStore";
import { useToastStore } from "../store/toastStore";
import {
	Copy,
	Check,
	LogOut,
	AlertTriangle,
	Flag,
	Handshake,
} from "lucide-react";
import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { getPossibleMoves, getCapturedPieces } from "../utils/chessUtils";
import PromotionModal from "./PromotionModal";

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
		resignGame,
		offerDraw,
		acceptDraw,
	} = useGameStore();
	const { addToast } = useToastStore();
	const navigate = useNavigate();

	const [copied, setCopied] = useState(false);
	const [promotionMove, setPromotionMove] = useState<{
		from: [number, number];
		to: [number, number];
	} | null>(null);

	const inCheck = useGameStore((s) => s.inCheck);
	const winner = useGameStore((s) => s.winner);
	const drawOffer = useGameStore((s) => s.drawOffer);

	// Calculate captured pieces based on current board state
	const capturedByCurrentPlayer = useMemo(
		() => getCapturedPieces(board, currentTurn),
		[board, currentTurn],
	);

	// Initialize game notifications hook
	useGameNotifications();

	const possibleMoves = useMemo(() => {
		if (!selectedSquare || !playerColor || status !== "active") return [];
		return getPossibleMoves(board, selectedSquare, playerColor);
	}, [selectedSquare, board, playerColor, status]);

	const isPossibleMove = (row: number, col: number) =>
		possibleMoves.some(([r, c]) => r === row && c === col);

	const handleLeaveGame = () => {
		leaveGame();
		navigate("/");
	};

	const handleResign = async () => {
		if (confirm("Are you sure you want to resign?")) {
			await resignGame();
		}
	};

	const handleOfferDraw = async () => {
		await offerDraw();
		addToast("Draw offer sent", "success");
	};

	const handleAcceptDraw = async () => {
		await acceptDraw();
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
			// If user clicks the same selected square again, just unselect it
			if (selectedSquare[0] === row && selectedSquare[1] === col) {
				selectSquare(null);
				return;
			}
			const piece = board[selectedSquare[0]][selectedSquare[1]];
			const isPromotion =
				piece.toLowerCase() === "p" && (row === 0 || row === 7);

			if (isPromotion) {
				setPromotionMove({ from: selectedSquare, to: [row, col] });
				return;
			}

			try {
				await makeMove(selectedSquare, [row, col]);
			} catch (error: unknown) {
				if (error instanceof Error) {
					addToast(error.message, "error");
				} else {
					addToast("Something went wrong", "error");
				}
				selectSquare(null);
			}
		}
	};

	const handlePromotion = async (piece: string) => {
		if (!promotionMove) return;
		try {
			await makeMove(promotionMove.from, promotionMove.to, piece);
			setPromotionMove(null);
			selectSquare(null);
		} catch (error: unknown) {
			if (error instanceof Error) {
				addToast(error.message, "error");
			}
			setPromotionMove(null);
			selectSquare(null);
		}
	};

	const isSelected = (row: number, col: number) =>
		selectedSquare && selectedSquare[0] === row && selectedSquare[1] === col;

	const isPlayerPiece = (piece: string) => {
		if (piece === ".") return false;
		return (
			(playerColor === "white" && piece === piece.toUpperCase()) ||
			(playerColor === "black" && piece === piece.toLowerCase())
		);
	};

	const displayBoard =
		playerColor === "black"
			? [...board].reverse().map((row) => [...row].reverse())
			: board;

	return (
		<div className="flex flex-col items-center justify-center p-4 min-h-screen">
			{promotionMove && (
				<PromotionModal onSelect={handlePromotion} color={playerColor!} />
			)}

			<div className="flex flex-col items-center gap-4">
				<div className="flex items-center justify-center gap-3 text-xs px-4 py-2 rounded flex-wrap">
					<button
						onClick={handleLeaveGame}
						className="px-3 py-1 bg-gray-500 hover:bg-gray-600 rounded flex items-center gap-1 "
					>
						<LogOut size={12} />
						Leave
					</button>
					{status === "active" && (
						<>
							<button
								onClick={handleResign}
								className="px-3 py-1 bg-red-500 hover:bg-red-600 rounded flex items-center gap-1 "
							>
								<Flag size={12} />
								Resign
							</button>
							{drawOffer !== playerColor && (
								<button
									onClick={handleOfferDraw}
									className="px-3 py-1 bg-blue-500 hover:bg-blue-600 rounded flex items-center gap-1 "
								>
									<Handshake size={12} />
									Offer Draw
								</button>
							)}
							{drawOffer && drawOffer !== playerColor && (
								<button
									onClick={handleAcceptDraw}
									className="px-3 py-1 bg-green-500 hover:bg-green-600 rounded flex items-center gap-1  animate-pulse"
								>
									<Handshake size={12} />
									Accept Draw
								</button>
							)}
						</>
					)}
					<span className="flex items-center gap-1 font-mono">
						<button onClick={copyGameCode} disabled={!gameCode}>
							{copied ? <Check size={12} /> : <Copy size={12} />}
						</button>
						{gameCode}
					</span>

					{inCheck && currentTurn === playerColor && status === "active" && (
						<span className="flex items-center gap-1 text-red-500 font-bold">
							<AlertTriangle size={12} />
							Check!
						</span>
					)}
					{status === "finished" && (
						<span className="font-bold text-(--info) uppercase">
							Game Over: {winner === "draw" ? "Draw" : `${winner} wins!`}
						</span>
					)}
				</div>

				<div className="max-w-full">
					{displayBoard.map((row, rowIndex) => {
						const actualRow = playerColor === "black" ? 7 - rowIndex : rowIndex;
						return (
							<div key={rowIndex} className="flex">
								{row.map((piece, colIndex) => {
									const actualCol =
										playerColor === "black" ? 7 - colIndex : colIndex;
									const isLight = (actualRow + actualCol) % 2 === 0;
									const highlight =
										currentTurn === playerColor &&
										isPlayerPiece(piece) &&
										status === "active";
									return (
										<div
											key={`${rowIndex}-${colIndex}`}
											className={`w-17.5 h-17.5 flex items-center justify-center cursor-pointer transition-opacity hover:opacity-80 relative ${
												isLight
													? "bg-(--accent-light)/90"
													: "bg-(--accent-dark)"
											} ${isSelected(actualRow, actualCol) ? "bg-(--success) shadow-inner" : ""} ${
												highlight ? "ring-2 ring-(--warning) ring-inset" : ""
											}`}
											onClick={() => handleSquareClick(actualRow, actualCol)}
										>
											{isPossibleMove(actualRow, actualCol) && (
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
						);
					})}
				</div>
			</div>

			<div className="flex flex-wrap gap-2 justify-center max-w-xs mt-2">
				{capturedByCurrentPlayer.map((p, i) => (
					<span key={i} className="text-2xl">
						{PIECE_SYMBOLS[p]}
					</span>
				))}
			</div>
		</div>
	);
}
