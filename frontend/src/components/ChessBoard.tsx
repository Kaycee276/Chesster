import { useGameStore, useGameNotifications } from "../store/gameStore";
import { useToastStore } from "../store/toastStore";
import {
	Copy,
	Check,
	LogOut,
	AlertTriangle,
	Flag,
	Handshake,
	Lock,
	ExternalLink,
	Loader2,
	CheckCircle2,
	X,
} from "lucide-react";

const WETH_SEPOLIA = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14";
const EXPLORER_BASE = "https://sepolia.etherscan.io/tx/";

function tokenLabel(addr: string): string {
	if (addr.toLowerCase() === WETH_SEPOLIA.toLowerCase()) return "WETH";
	return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getPossibleMoves, getCapturedPieces } from "../utils/chessUtils";
import PromotionModal from "./PromotionModal";
import TurnTimer from "./TurnTimer";

const PIECE_SYMBOLS: Record<string, string> = {
	K: "♔",
	Q: "♕",
	R: "♖",
	B: "♗",
	N: "♘",
	P: "♙",
	k: "♚",
	q: "♛",
	r: "♜",
	b: "♝",
	n: "♞",
	p: "♟",
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

// Board occupies the smaller of: (viewport width − 8px), (viewport height − 10rem), capped at 600px
const BOARD_SIZE = "min(calc(100vw - 8px), calc(100svh - 10rem), 600px)";

// ── Skeleton shown while game state loads ─────────────────────────────────────
function BoardSkeleton() {
	return (
		<div className="h-svh w-screen overflow-hidden flex flex-col items-center justify-center bg-(--bg) select-none p-1 gap-1.5">
			{/* Opponent info bar skeleton */}
			<div
				className="h-11 rounded-xl bg-(--bg-secondary) animate-pulse shrink-0"
				style={{ width: BOARD_SIZE }}
			/>
			{/* Board skeleton */}
			<div
				className="rounded-sm overflow-hidden shadow-2xl shrink-0"
				style={{ width: BOARD_SIZE, height: BOARD_SIZE }}
			>
				<div
					style={{
						display: "grid",
						gridTemplateColumns: "repeat(8, 1fr)",
						gridTemplateRows: "repeat(8, 1fr)",
						height: "100%",
					}}
				>
					{Array.from({ length: 64 }).map((_, i) => (
						<div
							key={i}
							className={`animate-pulse ${
								(Math.floor(i / 8) + (i % 8)) % 2 === 0
									? "bg-(--accent-light)/30"
									: "bg-(--accent-dark)/70"
							}`}
						/>
					))}
				</div>
			</div>
			{/* Player info bar skeleton */}
			<div
				className="h-11 rounded-xl bg-(--bg-secondary) animate-pulse shrink-0"
				style={{ width: BOARD_SIZE }}
			/>
			{/* Action bar skeleton */}
			<div
				className="h-10 rounded-xl bg-(--bg-secondary) animate-pulse shrink-0"
				style={{ width: BOARD_SIZE }}
			/>
		</div>
	);
}

// Outer wrapper: shows skeleton until board data arrives (keeps hooks rule-safe)
export default function ChessBoard() {
	const board = useGameStore((s) => s.board);
	if (!board || board.length === 0) return <BoardSkeleton />;
	return <ChessBoardInner />;
}

function ChessBoardInner() {
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
	const { addToast, removeToast } = useToastStore();
	const navigate = useNavigate();

	const [copied, setCopied] = useState(false);
	const [isMoving, setIsMoving] = useState(false);
	const [promotionMove, setPromotionMove] = useState<{
		from: [number, number];
		to: [number, number];
	} | null>(null);
	const [showPayoutModal, setShowPayoutModal] = useState(false);

	const inCheck = useGameStore((s) => s.inCheck);
	const winner = useGameStore((s) => s.winner);
	const drawOffer = useGameStore((s) => s.drawOffer);
	const secondsLeft = useGameStore((s) => s.secondsLeft);
	const wagerAmount = useGameStore((s) => s.wagerAmount);
	const tokenAddress = useGameStore((s) => s.tokenAddress);
	const escrowStatus = useGameStore((s) => s.escrowStatus);
	const escrowCreateTx = useGameStore((s) => s.escrowCreateTx);
	const escrowJoinTx = useGameStore((s) => s.escrowJoinTx);
	const escrowResolveTx = useGameStore((s) => s.escrowResolveTx);

	// Pot = each player's stake × 2 (only meaningful once both joined)
	const potDisplay =
		wagerAmount && tokenAddress
			? `${parseFloat(String(wagerAmount)) * 2} ${tokenLabel(tokenAddress)}`
			: null;

	// Current player will receive tokens when game ends
	const willReceiveTokens =
		status === "finished" &&
		!!wagerAmount &&
		(winner === playerColor || winner === "draw");

	const capturedByCurrentPlayer = useMemo(
		() => getCapturedPieces(board, currentTurn),
		[board, currentTurn],
	);

	useGameNotifications();

	// Auto-open payout modal when the game ends and this player is due a payout
	useEffect(() => {
		if (status === "finished" && willReceiveTokens) {
			setShowPayoutModal(true);
		}
	}, [status, willReceiveTokens]);

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
		if (status !== "active" || currentTurn !== playerColor || isMoving) return;

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
			if (selectedSquare[0] === row && selectedSquare[1] === col) {
				selectSquare(null);
				return;
			}
			const clickedPiece = board[row][col];
			if (clickedPiece !== "." && isPlayerPiece(clickedPiece)) {
				selectSquare([row, col]);
				return;
			}

			const piece = board[selectedSquare[0]][selectedSquare[1]];
			const isPromotion =
				piece.toLowerCase() === "p" && (row === 0 || row === 7);

			if (isPromotion) {
				setPromotionMove({ from: selectedSquare, to: [row, col] });
				return;
			}

			setIsMoving(true);
			const toastId = addToast("Moving...", "loading");
			try {
				await makeMove(selectedSquare, [row, col]);
			} catch (error: unknown) {
				if (error instanceof Error) {
					addToast(error.message, "error");
				} else {
					addToast("Something went wrong", "error");
				}
				selectSquare(null);
			} finally {
				removeToast(toastId);
				setIsMoving(false);
			}
		}
	};

	const handlePromotion = async (piece: string) => {
		if (!promotionMove) return;
		setIsMoving(true);
		const toastId = addToast("Promoting...", "loading");
		try {
			await makeMove(promotionMove.from, promotionMove.to, piece);
		} catch (error: unknown) {
			if (error instanceof Error) {
				addToast(error.message, "error");
			}
		} finally {
			removeToast(toastId);
			setIsMoving(false);
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

	const opponentColor = playerColor === "white" ? "black" : "white";
	const isMyTurn = currentTurn === playerColor;

	const PlayerAvatar = ({ color }: { color: "white" | "black" }) => (
		<div
			className={`w-7 h-7 rounded-full flex items-center justify-center text-base border-2 shrink-0 ${
				color === "white"
					? "bg-white border-gray-300 text-gray-900"
					: "bg-gray-900 border-gray-600 text-white"
			}`}
		>
			{color === "white" ? "♔" : "♚"}
		</div>
	);

	return (
		<div className="h-svh w-screen overflow-hidden flex flex-col items-center justify-center bg-(--bg) select-none p-1 gap-1.5">
			{promotionMove && (
				<PromotionModal onSelect={handlePromotion} color={playerColor!} />
			)}

			{/* ── Payout Modal ── */}
			{showPayoutModal && wagerAmount && tokenAddress && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
					<div className="relative w-full max-w-sm mx-4 bg-(--bg-secondary) border border-(--border) rounded-2xl p-6 flex flex-col gap-5 shadow-2xl">
						{/* Close button — only after payout is confirmed */}
						{escrowResolveTx && (
							<button
								onClick={() => setShowPayoutModal(false)}
								className="absolute top-4 right-4 text-(--text-tertiary) hover:text-(--text) transition-colors"
							>
								<X size={16} />
							</button>
						)}

						{/* Title */}
						<div className="flex flex-col gap-0.5">
							<p className="text-xs font-semibold uppercase tracking-widest text-(--text-tertiary)">
								{winner === "draw" ? "Draw Payout" : "Payout"}
							</p>
							<h3 className="text-xl font-bold">
								{winner === "draw" ? "Returning your wager" : "Sending your winnings"}
							</h3>
						</div>

						{/* Amount */}
						<div className="bg-(--bg) rounded-xl p-4 flex flex-col gap-0.5">
							<p className="text-xs text-(--text-tertiary)">Amount</p>
							<p className="text-2xl font-bold">
								{winner === "draw"
									? `${wagerAmount} `
									: `${(parseFloat(String(wagerAmount)) * 2 * 0.95).toFixed(6)} `}
								<span className="text-base font-semibold text-(--text-secondary)">
									{tokenLabel(tokenAddress)}
								</span>
							</p>
						</div>

						{/* Status */}
						{escrowResolveTx ? (
							<div className="flex flex-col gap-3">
								<div className="flex items-center gap-2 text-green-400">
									<CheckCircle2 size={20} className="shrink-0" />
									<span className="font-semibold">
										{winner === "draw" ? "Wager returned!" : "Tokens sent to your wallet!"}
									</span>
								</div>
								<a
									href={`${EXPLORER_BASE}${escrowResolveTx}`}
									target="_blank"
									rel="noopener noreferrer"
									className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-green-500/15 border border-green-500/30 text-green-400 hover:bg-green-500/25 transition-colors text-sm font-semibold"
								>
									<ExternalLink size={14} />
									View transaction on Etherscan
								</a>
								<p className="text-xs text-(--text-tertiary) text-center">
									Payout visible under the "Internal Txns" tab of the contract address
								</p>
							</div>
						) : (
							<div className="flex flex-col gap-2">
								<div className="flex items-center gap-2 text-yellow-400">
									<Loader2 size={18} className="animate-spin shrink-0" />
									<span className="font-medium text-sm">
										{winner === "draw"
											? "Returning your wager on-chain…"
											: "Sending tokens to your wallet on-chain…"}
									</span>
								</div>
								<p className="text-xs text-(--text-tertiary)">
									This may take a few seconds. Please keep this tab open.
								</p>
							</div>
						)}
					</div>
				</div>
			)}

			{/* ── Opponent Info Bar ── */}
			<div
				className="flex items-center justify-between px-3 py-2 rounded-xl bg-(--bg-secondary) border border-(--border) shrink-0"
				style={{ width: BOARD_SIZE }}
			>
				<div className="flex items-center gap-2 min-w-0">
					<PlayerAvatar color={opponentColor as "white" | "black"} />
					<span className="text-xs font-semibold uppercase tracking-wider text-(--text-secondary) truncate">
						Opponent · {opponentColor}
					</span>
				</div>
				<div className="flex items-center gap-2 shrink-0">
					{status === "active" && !isMyTurn && (
						<TurnTimer secondsLeft={secondsLeft} isMyTurn={false} />
					)}
					{status === "active" && isMyTurn && (
						<span className="text-xs text-(--text-tertiary) italic">
							thinking…
						</span>
					)}
				</div>
			</div>

			{/* ── Chess Board ── */}
			<div
				className={`shrink-0 rounded-sm overflow-hidden shadow-2xl relative transition-opacity ${isMoving ? "opacity-70" : "opacity-100"}`}
				style={
					{
						width: BOARD_SIZE,
						height: BOARD_SIZE,
						display: "grid",
						gridTemplateColumns: "repeat(8, 1fr)",
						gridTemplateRows: "repeat(8, 1fr)",
						"--board-size": BOARD_SIZE,
					} as React.CSSProperties
				}
			>
				{displayBoard.map((row, rowIndex) =>
					row.map((piece, colIndex) => {
						const actualRow = playerColor === "black" ? 7 - rowIndex : rowIndex;
						const actualCol = playerColor === "black" ? 7 - colIndex : colIndex;
						const isLight = (actualRow + actualCol) % 2 === 0;
						const selected = isSelected(actualRow, actualCol);
						const possible = isPossibleMove(actualRow, actualCol);
						const isKingInCheck =
							inCheck &&
							isMyTurn &&
							piece.toLowerCase() === "k" &&
							isPlayerPiece(piece);
						const highlight =
							isMyTurn &&
							isPlayerPiece(piece) &&
							status === "active" &&
							!selected;

						return (
							<div
								key={`${rowIndex}-${colIndex}`}
								className={`relative flex items-center justify-center cursor-pointer transition-[filter] hover:brightness-110 ${
									isLight ? "bg-(--accent-light)/90" : "bg-(--accent-dark)"
								} ${selected ? "bg-yellow-400/75" : ""} ${
									isKingInCheck ? "bg-red-500/80" : ""
								} ${highlight ? " outline-2 outline-yellow-300/60 -outline-offset-2" : ""}`}
								onClick={() => handleSquareClick(actualRow, actualCol)}
							>
								{/* Possible-move dot */}
								{possible && (
									<div
										className="absolute rounded-full bg-black/30 dark:bg-white/25 pointer-events-none"
										style={{
											width: "calc(var(--board-size) / 8 * 0.32)",
											height: "calc(var(--board-size) / 8 * 0.32)",
										}}
									/>
								)}
								{/* Piece */}
								{piece !== "." && (
									<span
										className="leading-none pointer-events-none"
										style={{
											fontSize: "calc(var(--board-size) / 8 * 0.72)",
											...(piece === piece.toUpperCase()
												? WHITE_PIECE_STYLE
												: BLACK_PIECE_STYLE),
										}}
									>
										{PIECE_SYMBOLS[piece]}
									</span>
								)}
							</div>
						);
					}),
				)}
			</div>

			{/* ── Player Info Bar ── */}
			<div
				className="flex items-center justify-between px-3 py-2 rounded-xl bg-(--bg-secondary) border border-(--border) shrink-0"
				style={{ width: BOARD_SIZE }}
			>
				<div className="flex items-center gap-2 min-w-0">
					<PlayerAvatar color={playerColor as "white" | "black"} />
					<span className="text-xs font-semibold uppercase tracking-wider truncate">
						You · {playerColor}
					</span>
					{/* Captured pieces */}
					{capturedByCurrentPlayer.length > 0 && (
						<div className="flex overflow-hidden max-w-25 shrink-0">
							{capturedByCurrentPlayer.map((p, i) => (
								<span
									key={i}
									className="leading-none"
									style={{
										fontSize: "0.8rem",
										...(p === p.toUpperCase()
											? WHITE_PIECE_STYLE
											: BLACK_PIECE_STYLE),
									}}
								>
									{PIECE_SYMBOLS[p]}
								</span>
							))}
						</div>
					)}
				</div>
				<div className="flex items-center gap-2 shrink-0">
					{inCheck && isMyTurn && status === "active" && (
						<span className="flex items-center gap-1 text-red-500 font-bold text-xs animate-pulse">
							<AlertTriangle size={10} />
							CHECK!
						</span>
					)}
					{status === "active" && isMyTurn && (
						<TurnTimer secondsLeft={secondsLeft} isMyTurn={true} />
					)}
					{status === "active" && !isMyTurn && (
						<span className="text-xs text-(--text-tertiary) italic">
							your turn next
						</span>
					)}
					{status === "finished" && (
						<span className="font-bold text-(--info) uppercase text-xs tracking-wide">
							{winner === "draw"
								? "Draw!"
								: winner === playerColor
									? "You win!"
									: "You lose"}
						</span>
					)}
				</div>
			</div>

			
			{/* ── Escrow TX Links (wagered games only) ── */}
			{wagerAmount && (
				<div
					className={`flex items-center gap-2 px-3 py-2 rounded-xl border shrink-0 flex-wrap ${
						escrowStatus === "failed"
							? "bg-red-500/10 border-red-500/30"
							: "bg-(--bg-secondary) border-(--border)"
					}`}
					style={{ width: BOARD_SIZE }}
				>
					{escrowStatus === "failed" ? (
						<span className="flex items-center gap-1 text-xs text-red-400 font-semibold">
							<AlertTriangle size={10} />
							Escrow failed — contact support
						</span>
					) : (
						<>
							{/* Sending / sent tokens feedback — shown only to recipients */}
							{status === "finished" && willReceiveTokens && (
								escrowResolveTx ? (
									<span className="flex items-center gap-1.5 text-xs text-green-400 font-semibold w-full">
										<CheckCircle2 size={12} className="shrink-0" />
										{winner === "draw" ? "Wager returned" : "Tokens sent"}
										{" · "}
										<a
											href={`${EXPLORER_BASE}${escrowResolveTx}`}
											target="_blank"
											rel="noopener noreferrer"
											className="flex items-center gap-0.5 hover:underline font-normal"
										>
											<ExternalLink size={10} />
											View tx
										</a>
									</span>
								) : (
									<span className="flex items-center gap-1.5 text-xs text-yellow-400 font-medium w-full">
										<Loader2 size={12} className="animate-spin shrink-0" />
										{winner === "draw" ? "Returning your wager…" : "Sending tokens to you…"}
									</span>
								)
							)}

							{/* TX links row */}
							{(escrowCreateTx || escrowJoinTx || escrowResolveTx) ? (
								<>
									<span className="text-xs text-(--text-tertiary) shrink-0">
										{escrowStatus === "settled" ? "Settled ·" : "Escrow ·"}
									</span>
									{escrowCreateTx && (
										<a
											href={`${EXPLORER_BASE}${escrowCreateTx}`}
											target="_blank"
											rel="noopener noreferrer"
											className="flex items-center gap-1 text-xs text-(--accent-primary) hover:underline shrink-0"
										>
											<ExternalLink size={10} />
											Create
										</a>
									)}
									{escrowJoinTx && (
										<a
											href={`${EXPLORER_BASE}${escrowJoinTx}`}
											target="_blank"
											rel="noopener noreferrer"
											className="flex items-center gap-1 text-xs text-(--accent-primary) hover:underline shrink-0"
										>
											<ExternalLink size={10} />
											Join
										</a>
									)}
									{escrowResolveTx && (
										<a
											href={`${EXPLORER_BASE}${escrowResolveTx}`}
											target="_blank"
											rel="noopener noreferrer"
											className="flex items-center gap-1 text-xs text-green-400 hover:underline shrink-0 font-semibold"
										>
											<ExternalLink size={10} />
											Settle
										</a>
									)}
								</>
							) : (
								!(status === "finished" && willReceiveTokens) && (
									<span className="text-xs text-(--text-tertiary)">
										{escrowStatus === "active" ? "Escrow active" : "Escrow pending…"}
									</span>
								)
							)}
						</>
					)}
				</div>
			)}

			{/* ── Action Bar ── */}
			<div
				className="flex items-center justify-between px-3 py-2 rounded-xl bg-(--bg-secondary) border border-(--border) gap-2 shrink-0"
				style={{ width: BOARD_SIZE }}
			>
				{/* Game actions */}
				<div className="flex items-center gap-1.5">
					<button
						onClick={handleLeaveGame}
						className="px-2.5 py-1 bg-(--bg-tertiary) hover:bg-gray-600 text-(--text-secondary) hover:text-white rounded-lg flex items-center gap-1 text-xs transition-colors"
					>
						<LogOut size={11} />
						Leave
					</button>
					{status === "active" && (
						<>
							<button
								onClick={handleResign}
								className="px-2.5 py-1 bg-red-500/15 hover:bg-red-500 text-red-400 hover:text-white rounded-lg flex items-center gap-1 text-xs transition-colors"
							>
								<Flag size={11} />
								Resign
							</button>
							{drawOffer !== playerColor && (
								<button
									onClick={handleOfferDraw}
									className="px-2.5 py-1 bg-blue-500/15 hover:bg-blue-500 text-blue-400 hover:text-white rounded-lg flex items-center gap-1 text-xs transition-colors"
								>
									<Handshake size={11} />
									Draw
								</button>
							)}
							{drawOffer && drawOffer !== playerColor && (
								<button
									onClick={handleAcceptDraw}
									className="px-2.5 py-1 bg-green-500 hover:bg-green-600 text-white rounded-lg flex items-center gap-1 text-xs transition-colors animate-pulse"
								>
									<Handshake size={11} />
									Accept
								</button>
							)}
						</>
					)}
				</div>

				{/* Right side: stake badge + game code */}
				<div className="flex items-center gap-1.5 shrink-0">
					{potDisplay && (
						<div
							title="Total pot locked in escrow"
							className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold border ${
								status === "finished" && winner !== "draw" && winner === playerColor
									? "bg-green-500/15 border-green-500/30 text-green-400"
									: "bg-yellow-500/10 border-yellow-500/25 text-yellow-400"
							}`}
						>
							<Lock size={9} />
							{potDisplay}
						</div>
					)}
					<button
						onClick={copyGameCode}
						disabled={!gameCode}
						title="Copy game code"
						className="flex items-center gap-1.5 px-2.5 py-1 bg-(--bg-tertiary) hover:bg-gray-600 text-(--text-secondary) hover:text-white rounded-lg text-xs font-mono transition-colors disabled:opacity-40"
					>
						{copied ? <Check size={11} /> : <Copy size={11} />}
						{gameCode}
					</button>
				</div>
			</div>
		</div>
	);
}
