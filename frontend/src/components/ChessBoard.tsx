import { useGameStore, useGameNotifications, useSoundEffects } from "../store/gameStore";
import { useToastStore } from "../store/toastStore";
import { soundService } from "../services/soundService";
import { friendlyError } from "../utils/errorMessages";
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
	Volume2,
	VolumeX,
	RefreshCw,
	Maximize2,
	Minimize2,
	SkipBack,
	SkipForward,
	ChevronLeft,
	ChevronRight,
} from "lucide-react";

const NATIVE_XLM = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const EXPLORER_BASE = "https://stellar.expert/explorer/testnet/tx/";

function tokenLabel(addr: string | null | undefined): string {
	if (!addr) return "XLM";
	if (addr === NATIVE_XLM) return "XLM";
	return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
import { useState, useMemo, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { getPossibleMoves, getCapturedPieces, materialAdvantage } from "../utils/chessUtils";
import PromotionModal from "./PromotionModal";
import ConfirmModal from "./ConfirmModal";
import TurnTimer from "./TurnTimer";
import ChatPanel from "./ChatPanel";

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

// ── Skeleton shown while game state loads ─────────────────────────────────────
function BoardSkeleton() {
	return (
		<div className="h-dvh w-dvw overflow-hidden flex flex-col bg-(--bg) select-none p-1 gap-1">
			<div className="h-10 rounded-xl bg-(--bg-secondary) animate-pulse shrink-0" />
			<div className="flex-1 min-h-0 flex items-center justify-center overflow-hidden">
				<div className="aspect-square h-full max-w-full rounded-sm overflow-hidden shadow-2xl">
					<div
						className="w-full h-full"
						style={{
							display: "grid",
							gridTemplateColumns: "repeat(8, 1fr)",
							gridTemplateRows: "repeat(8, 1fr)",
						}}
					>
						{Array.from({ length: 64 }).map((_, i) => (
							<div
								key={i}
								className={`animate-pulse ${
									(Math.floor(i / 8) + (i % 8)) % 2 === 0
										? "bg-(--sq-light)/50"
										: "bg-(--sq-dark)/60"
								}`}
							/>
						))}
					</div>
				</div>
			</div>
			<div className="h-10 rounded-xl bg-(--bg-secondary) animate-pulse shrink-0" />
			<div className="h-10 rounded-xl bg-(--bg-secondary) animate-pulse shrink-0" />
		</div>
	);
}

// ── Waiting screen shown to the creator before an opponent joins ──────────────
function WaitingScreen() {
	const gameCode = useGameStore((s) => s.gameCode);
	const status = useGameStore((s) => s.status);
	const wagerAmount = useGameStore((s) => s.wagerAmount);
	const tokenAddress = useGameStore((s) => s.tokenAddress);
	const leaveGame = useGameStore((s) => s.leaveGame);
	const { addToast } = useToastStore();
	const navigate = useNavigate();
	const [copied, setCopied] = useState(false);
	const [confirmLeave, setConfirmLeave] = useState(false);

	// Handle auto-cancellation (game expired after 1 hour with no opponent)
	useEffect(() => {
		if (status === "cancelled") {
			addToast(
				"Your game was cancelled — no one joined within 1 hour. Your wager (if any) has been refunded.",
				"info",
			);
			leaveGame();
			navigate("/");
		}
	}, [status, addToast, leaveGame, navigate]);

	const copyCode = async () => {
		if (!gameCode) return;
		await navigator.clipboard.writeText(gameCode);
		setCopied(true);
		setTimeout(() => setCopied(false), 1200);
	};

	const handleLeave = () => {
		leaveGame();
		navigate("/");
	};

	const potDisplay = wagerAmount
		? `${parseFloat(String(wagerAmount)) * 2} ${tokenLabel(tokenAddress)}`
		: null;

	return (
		<div className="h-dvh w-dvw flex flex-col items-center justify-center bg-(--bg) p-4 gap-6">
			{confirmLeave && (
				<ConfirmModal
					title="Leave game?"
					message={
						wagerAmount
							? "Your wager is locked on-chain and will be refunded only after the game expires (1 hour). Are you sure?"
							: "Are you sure you want to leave while waiting?"
					}
					confirmLabel="Leave"
					onConfirm={handleLeave}
					onCancel={() => setConfirmLeave(false)}
				/>
			)}

			<div className="flex flex-col items-center gap-6 w-full max-w-sm">
				{/* Animated chess king spinner */}
				<div className="relative w-20 h-20">
					<div className="absolute inset-0 rounded-full border-4 border-(--bg-secondary) border-t-(--accent-primary) animate-spin" />
					<span className="absolute inset-0 flex items-center justify-center text-3xl select-none">
						♔
					</span>
				</div>

				{/* Title */}
				<div className="text-center flex flex-col gap-1">
					<h2 className="text-xl font-bold">Waiting for opponent…</h2>
					<p className="text-sm text-(--text-tertiary)">
						Share the game code below to invite someone
					</p>
				</div>

				{/* Copyable game code */}
				<button
					onClick={copyCode}
					className="flex items-center gap-3 px-6 py-3 bg-(--bg-secondary) border border-(--border) rounded-xl font-mono text-2xl font-bold tracking-widest hover:border-(--accent-primary)/60 transition-colors"
				>
					{gameCode}
					{copied ? (
						<Check size={16} className="text-green-400 shrink-0" />
					) : (
						<Copy size={16} className="text-(--text-tertiary) shrink-0" />
					)}
				</button>

				{/* Wager notice */}
				{wagerAmount && (
					<div className="flex items-center gap-2 text-xs text-yellow-400 bg-yellow-400/10 border border-yellow-400/20 rounded-lg px-3 py-2 text-center leading-relaxed">
						<Lock size={12} className="shrink-0" />
						<span>
							<span className="font-semibold">{potDisplay}</span> locked in
							escrow — released when the game ends
						</span>
					</div>
				)}

				{/* Leave */}
				<button
					onClick={() => (wagerAmount ? setConfirmLeave(true) : handleLeave())}
					className="text-sm text-(--text-tertiary) hover:text-(--text) transition-colors underline underline-offset-2"
				>
					Leave game
				</button>
			</div>
		</div>
	);
}

// Outer wrapper: shows skeleton until board data arrives (keeps hooks rule-safe)
export default function ChessBoard() {
	const board = useGameStore((s) => s.board);
	const status = useGameStore((s) => s.status);
	if (!board || board.length === 0) return <BoardSkeleton />;
	if (status === "waiting") return <WaitingScreen />;
	return <ChessBoardInner />;
}

function PlayerAvatar({ color }: { color: "white" | "black" }) {
	return (
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
}

function CapturedIcons({ captured }: { captured: string[] }) {
	if (captured.length === 0) return null;
	return (
		<div className="flex overflow-hidden shrink-0" style={{ maxWidth: "6rem" }}>
			{captured.map((p, i) => (
				<span
					key={i}
					className="leading-none"
					style={{
						fontSize: "0.75rem",
						...(p === p.toUpperCase() ? WHITE_PIECE_STYLE : BLACK_PIECE_STYLE),
					}}
				>
					{PIECE_SYMBOLS[p]}
				</span>
			))}
		</div>
	);
}

function MaterialChip({
	advantage,
	label,
}: {
	advantage: number;
	label: string;
}) {
	if (advantage === 0) return null;
	return (
		<span
			title={`${label} material advantage`}
			className={`text-[10px] font-bold shrink-0 tabular-nums ${
				advantage > 0 ? "text-green-400" : "text-red-400"
			}`}
		>
			{advantage > 0 ? "+" : "−"}
			{Math.abs(advantage)}
		</span>
	);
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
		fetchGameState,
		moveHistory,
		viewingIndex,
		setViewingIndex,
		loadMoveHistory,
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
	const [confirmAction, setConfirmAction] = useState<"resign" | "leave" | null>(null);
	const [soundEnabled, setSoundEnabled] = useState(() => soundService.isEnabled());
	const [volume, setVolume] = useState(() => soundService.getVolume());
	const [showVolumeSlider, setShowVolumeSlider] = useState(false);
	const [flipped, setFlipped] = useState(false);

	// ── Piece move animation ───────────────────────────────────────────────────
	const lastMove = useGameStore((s) => s.lastMove);
	const [animKey, setAnimKey] = useState<string | null>(null);
	const [animOffset, setAnimOffset] = useState({ dx: 0, dy: 0 });
	const [captureKey, setCaptureKey] = useState<string | null>(null);
	const prevLastMoveRef = useRef<typeof lastMove>(null);
	const prevBoardRef = useRef<string[][]>([]);

	useEffect(() => {
		if (!lastMove) return;
		if (viewingIndex !== null) return;
		const prev = prevLastMoveRef.current;
		if (
			prev &&
			prev.from[0] === lastMove.from[0] &&
			prev.from[1] === lastMove.from[1] &&
			prev.to[0] === lastMove.to[0] &&
			prev.to[1] === lastMove.to[1]
		)
			return;

		// Detect capture: destination had an opponent piece before the move
		const prevBoard = prevBoardRef.current;
		if (prevBoard.length) {
			const destPiece = prevBoard[lastMove.to[0]]?.[lastMove.to[1]];
			const movingPiece = lastMove.piece;
			const isWhite = movingPiece === movingPiece.toUpperCase();
			const isCapture = destPiece && destPiece !== "." &&
				(isWhite ? destPiece === destPiece.toLowerCase() : destPiece === destPiece.toUpperCase());
			if (isCapture) {
				const ck = `${lastMove.to[0]}-${lastMove.to[1]}`;
				setCaptureKey(ck);
				setTimeout(() => setCaptureKey(null), 400);
			}
		}

		prevLastMoveRef.current = lastMove;

		// Compute how many squares the piece travelled, accounting for board flip
		const factor = playerColor === "black" ? -1 : 1;
		const dy = (lastMove.from[0] - lastMove.to[0]) * factor;
		const dx = (lastMove.from[1] - lastMove.to[1]) * factor;

		setAnimOffset({ dx, dy });
		setAnimKey(`${lastMove.to[0]}-${lastMove.to[1]}`);
		const t = setTimeout(() => setAnimKey(null), 380);
		return () => clearTimeout(t);
	}, [lastMove, playerColor, viewingIndex]);

	// Keep a snapshot of the board before each move so capture detection works
	useEffect(() => {
		prevBoardRef.current = board;
	}, [board]);

	const inCheck = useGameStore((s) => s.inCheck);
	const winner = useGameStore((s) => s.winner);
	const drawOffer = useGameStore((s) => s.drawOffer);
	const secondsLeft = useGameStore((s) => s.secondsLeft);
	const timeControlSeconds = useGameStore((s) => s.timeControlSeconds);
	const wagerAmount = useGameStore((s) => s.wagerAmount);
	const tokenAddress = useGameStore((s) => s.tokenAddress);
	const escrowStatus = useGameStore((s) => s.escrowStatus);
	const escrowResolveTx = useGameStore((s) => s.escrowResolveTx);

	// Pot = each player's stake × 2 (only meaningful once both joined)
	const potDisplay =
		wagerAmount
			? `${parseFloat(String(wagerAmount)) * 2} ${tokenLabel(tokenAddress)}`
			: null;

	// Current player will receive tokens when game ends
	const willReceiveTokens =
		status === "finished" &&
		!!wagerAmount &&
		(winner === playerColor || winner === "draw");

	const capturedByWhite = useMemo(
		() => getCapturedPieces(board, "white"),
		[board],
	);
	const capturedByBlack = useMemo(
		() => getCapturedPieces(board, "black"),
		[board],
	);
	const { white: whiteMaterial, black: blackMaterial } = useMemo(
		() => materialAdvantage(board),
		[board],
	);

	// Board state shown while rewinding move history (#112)
	const viewingBoard = useMemo(() => {
		if (viewingIndex !== null && moveHistory[viewingIndex]) {
			return moveHistory[viewingIndex].board_state_after;
		}
		return board;
	}, [viewingIndex, moveHistory, board]);

	const lastMoveForView = useMemo(() => {
		if (viewingIndex !== null && moveHistory[viewingIndex]) {
			const m = moveHistory[viewingIndex];
			return { from: m.from_position, to: m.to_position, piece: m.piece };
		}
		return lastMove;
	}, [viewingIndex, moveHistory, lastMove]);

	useGameNotifications();
	useSoundEffects();

	// ── Fullscreen mode toggle (#124) ─────────────────────────────────────────
	const [isFullscreen, setIsFullscreen] = useState(false);
	useEffect(() => {
		const onFullscreenChange = () =>
			setIsFullscreen(!!document.fullscreenElement);
		document.addEventListener("fullscreenchange", onFullscreenChange);
		return () =>
			document.removeEventListener("fullscreenchange", onFullscreenChange);
	}, []);

	const toggleFullscreen = () => {
		try {
			if (document.fullscreenElement) {
				void document.exitFullscreen();
			} else {
				void document.documentElement.requestFullscreen();
			}
		} catch {
			// Fullscreen unsupported or denied — ignore.
		}
	};

	// ── Keyboard shortcuts: "f" fullscreen (#124), arrows to rewind (#112) ────
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			const target = e.target as HTMLElement | null;
			if (
				target &&
				(target.tagName === "INPUT" ||
					target.tagName === "TEXTAREA" ||
					target.isContentEditable)
			)
				return;

			if (e.key.toLowerCase() === "f") {
				toggleFullscreen();
				return;
			}

			if (e.key === "ArrowLeft") {
				e.preventDefault();
				setViewingIndex(
					viewingIndex === null ? null : Math.max(0, viewingIndex - 1),
				);
			} else if (e.key === "ArrowRight") {
				e.preventDefault();
				setViewingIndex(
					viewingIndex === null
						? null
						: Math.min(moveHistory.length - 1, viewingIndex + 1),
				);
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [moveHistory.length, viewingIndex, setViewingIndex]);

	// Load move history once the board is present (#112)
	useEffect(() => {
		if (gameCode && moveHistory.length === 0) {
			loadMoveHistory();
		}
	}, [gameCode]); // eslint-disable-line react-hooks/exhaustive-deps

	// Auto-open payout modal when the game ends and this player is due a payout
	useEffect(() => {
		if (status === "finished" && willReceiveTokens) {
			const timer = setTimeout(() => setShowPayoutModal(true), 0);
			return () => clearTimeout(timer);
		}
	}, [status, willReceiveTokens]);

	// Safety net: if ChessBoardInner ever receives a cancelled status
	// (e.g. rejoining a cancelled game URL), redirect back to lobby.
	useEffect(() => {
		if (status === "cancelled") {
			addToast("Your game was cancelled — no one joined within 1 hour. Your wager (if any) has been refunded.", "info");
			leaveGame();
			navigate("/");
		}
	}, [status, addToast, leaveGame, navigate]);

	const possibleMoves = useMemo(() => {
		if (!selectedSquare || !playerColor || status !== "active") return [];
		return getPossibleMoves(board, selectedSquare, playerColor);
	}, [selectedSquare, board, playerColor, status]);

	const isPossibleMove = (row: number, col: number) =>
		possibleMoves.some(([r, c]) => r === row && c === col);

	const handleLeaveGame = () => {
		if (status === "active") {
			setConfirmAction("leave");
		} else {
			leaveGame();
			navigate("/");
		}
	};

	const handleResign = () => setConfirmAction("resign");

	const handleConfirm = async () => {
		if (confirmAction === "resign") {
			await resignGame();
		} else if (confirmAction === "leave") {
			leaveGame();
			navigate("/");
		}
		setConfirmAction(null);
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
		if (viewingIndex !== null) return;

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
				addToast(friendlyError(error), "error");
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
			addToast(friendlyError(error), "error");
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

	// ── Dynamic board sizing via ResizeObserver ───────────────────────────────
	const boardWrapperRef = useRef<HTMLDivElement>(null);
	const [boardPx, setBoardPx] = useState(0);
	useEffect(() => {
		const el = boardWrapperRef.current;
		if (!el) return;
		const update = () => setBoardPx(Math.min(el.clientWidth, el.clientHeight));
		const obs = new ResizeObserver(update);
		obs.observe(el);
		update();
		return () => obs.disconnect();
	}, []);

	const displayBoard =
		(playerColor === "black") !== flipped
			? [...viewingBoard].reverse().map((row) => [...row].reverse())
			: viewingBoard;

	const opponentColor = playerColor === "white" ? "black" : "white";
	const isMyTurn = currentTurn === playerColor;

	return (
		<div className="h-dvh w-dvw overflow-hidden flex flex-col bg-(--bg) select-none p-1 gap-1">
			{promotionMove && (
				<PromotionModal onSelect={handlePromotion} color={playerColor!} />
			)}

			{confirmAction && (
				<ConfirmModal
					title={confirmAction === "resign" ? "Resign game?" : "Leave game?"}
					message={
						confirmAction === "resign"
							? "Your opponent will be declared the winner. This cannot be undone."
							: "You will forfeit the game and your opponent wins. Are you sure?"
					}
					confirmLabel={confirmAction === "resign" ? "Resign" : "Leave"}
					onConfirm={handleConfirm}
					onCancel={() => setConfirmAction(null)}
				/>
			)}

			{/* ── Payout Modal ── */}
			{showPayoutModal && wagerAmount && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
					<div className="relative w-full max-w-sm mx-4 bg-(--bg-secondary) border border-(--border) rounded-2xl p-6 flex flex-col gap-5 shadow-2xl">
						{/* Close button — after payout confirmed or if escrow failed */}
						{(escrowResolveTx || escrowStatus === "settled" || escrowStatus === "failed") && (
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
								{winner === "draw"
									? "Returning your wager, you can leave the game now"
									: "Sending your winnings, you can leave the game now"}
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
						{(escrowResolveTx || escrowStatus === "settled") ? (
							<div className="flex flex-col gap-3">
								<div className="flex items-center gap-2 text-green-400">
									<CheckCircle2 size={20} className="shrink-0" />
									<span className="font-semibold">
										{winner === "draw"
											? "Wager returned!"
											: "Tokens sent to your wallet!"}
									</span>
								</div>
								{escrowResolveTx && (
									<a
										href={`${EXPLORER_BASE}${escrowResolveTx}`}
										target="_blank"
										rel="noopener noreferrer"
										className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-green-500/15 border border-green-500/30 text-green-400 hover:bg-green-500/25 transition-colors text-sm font-semibold"
									>
										<ExternalLink size={14} />
										View transaction on Stellar Expert
									</a>
								)}
								<p className="text-xs text-(--text-tertiary) text-center">
									Payout visible under the "Internal Txns" tab of the contract
									address
								</p>
							</div>
						) : escrowStatus === "failed" ? (
							<div className="flex flex-col gap-3">
								<div className="flex items-center gap-2 text-red-400">
									<AlertTriangle size={18} className="shrink-0" />
									<span className="font-medium text-sm">Payout could not be sent.</span>
								</div>
								<p className="text-xs text-(--text-tertiary) leading-relaxed">
									This sometimes happens due to a network hiccup. Try refreshing
									the page or tap the button below to check again.
								</p>
								<button
									onClick={() => fetchGameState()}
									className="w-full py-2.5 rounded-xl bg-(--accent-dark) hover:bg-(--accent-primary) text-sm font-semibold transition-colors flex items-center justify-center gap-2"
								>
									<Loader2 size={13} />
									Retry payout
								</button>
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

			{/* ── Opponent Bar ── */}
			<div className="shrink-0 flex items-center justify-between px-3 h-10 rounded-xl bg-(--bg-secondary) border border-(--border) min-w-0 gap-2 overflow-hidden">
				<div className="flex items-center gap-2 min-w-0 overflow-hidden">
					<PlayerAvatar color={opponentColor as "white" | "black"} />
					<span className="text-xs font-semibold uppercase tracking-wider text-(--text-secondary) truncate">
						Opponent · {opponentColor}
					</span>
					<MaterialChip
						advantage={
							opponentColor === "white"
								? whiteMaterial - blackMaterial
								: blackMaterial - whiteMaterial
						}
						label={opponentColor}
					/>
					<CapturedIcons
						captured={
							opponentColor === "white" ? capturedByWhite : capturedByBlack
						}
					/>
				</div>
				{status === "active" && isMyTurn && (
					<span className="text-xs text-(--text-tertiary) italic shrink-0">thinking…</span>
				)}
			</div>

			{/* ── Board (fills remaining height) ── */}
			<div
				ref={boardWrapperRef}
				className="relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden"
				style={{ touchAction: "none" }}
			>
				{viewingIndex !== null && (
					<div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/75 text-white text-[10px] font-semibold shadow-lg backdrop-blur-sm">
						<span className="whitespace-nowrap">
							Move {viewingIndex + 1} of {moveHistory.length}
						</span>
						<button
							onClick={() => setViewingIndex(null)}
							className="px-2 py-0.5 rounded-full bg-(--accent-dark) hover:bg-(--accent-primary) text-white text-[10px] font-bold transition-colors"
						>
							Live
						</button>
					</div>
				)}
				{boardPx > 0 && (
				<div
					className={`rounded-sm overflow-hidden shadow-2xl transition-opacity ${isMoving ? "opacity-70" : "opacity-100"}`}
					style={
						{
							width: boardPx,
							height: boardPx,
							display: "grid",
							gridTemplateColumns: "repeat(8, 1fr)",
							gridTemplateRows: "repeat(8, 1fr)",
							"--board-size": `${boardPx}px`,
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
						const capture = possible && board[actualRow][actualCol] !== ".";
						const reviewing = viewingIndex !== null;
						const isKingInCheck =
							!reviewing &&
							inCheck &&
							isMyTurn &&
							piece.toLowerCase() === "k" &&
							isPlayerPiece(piece);
						const highlight =
							!reviewing &&
							isMyTurn &&
							isPlayerPiece(piece) &&
							status === "active" &&
							!selected;
						const isLastMoveSquare =
							!selected &&
							!isKingInCheck &&
							lastMoveForView &&
							((actualRow === lastMoveForView.from[0] && actualCol === lastMoveForView.from[1]) ||
								(actualRow === lastMoveForView.to[0] && actualCol === lastMoveForView.to[1]));
						const isPieceAnimating = animKey === `${actualRow}-${actualCol}`;
						const isCaptureSquare = captureKey === `${actualRow}-${actualCol}`;

						return (
							<div
								key={`${rowIndex}-${colIndex}`}
								data-testid={`square-${actualRow}-${actualCol}`}
								className={`relative flex items-center justify-center cursor-pointer transition-[filter] hover:brightness-110 ${
									isLight ? "bg-(--sq-light)" : "bg-(--sq-dark)"
								} ${selected ? "bg-yellow-400/75" : ""} ${
									isKingInCheck ? "bg-red-500/80" : ""
								} ${isLastMoveSquare ? "bg-yellow-300/45" : ""} ${
									highlight ? " outline-2 outline-yellow-300/60 -outline-offset-2" : ""
								}`}
								style={isCaptureSquare ? { animation: "captureFlash 0.4s ease-out forwards" } : undefined}
								onClick={() => handleSquareClick(actualRow, actualCol)}
								onTouchEnd={(e) => {
									// Prevent the synthetic click that follows touch so the
									// handler doesn't fire twice on mobile browsers.
									e.preventDefault();
									handleSquareClick(actualRow, actualCol);
								}}
							>
								{/* Legal-move marker: dot on empty squares, ring on captures (#123) */}
								{possible && !capture && (
									<div
										className="absolute rounded-full bg-black/30 dark:bg-white/25 pointer-events-none"
										style={{
											width: "calc(var(--board-size) / 8 * 0.32)",
											height: "calc(var(--board-size) / 8 * 0.32)",
										}}
									/>
								)}
								{capture && (
									<div
										className="absolute rounded-full border-[3px] border-yellow-400/90 pointer-events-none"
										style={{
											width: "calc(var(--board-size) / 8 * 0.72)",
											height: "calc(var(--board-size) / 8 * 0.72)",
										}}
									/>
								)}
								{/* Piece */}
								{piece !== "." && (
									<span
										key={isPieceAnimating ? "anim" : "static"}
										className="leading-none pointer-events-none"
										style={{
											fontSize: "calc(var(--board-size) / 8 * 0.72)",
											...(piece === piece.toUpperCase()
												? WHITE_PIECE_STYLE
												: BLACK_PIECE_STYLE),
											...(isPieceAnimating && {
												animation: "pieceSlide 0.38s cubic-bezier(0.22,1,0.36,1) forwards",
												"--piece-dx": `calc(${animOffset.dx} * var(--board-size) / 8)`,
												"--piece-dy": `calc(${animOffset.dy} * var(--board-size) / 8)`,
											}),
										} as React.CSSProperties}
									>
										{PIECE_SYMBOLS[piece]}
									</span>
								)}
							</div>
						);
					}),
				)}
				</div>
				)}
			</div>

			{/* ── Player Bar ── */}
			<div className="shrink-0 flex items-center justify-between px-3 h-10 rounded-xl bg-(--bg-secondary) border border-(--border) min-w-0 gap-2 overflow-hidden">
				<div className="flex items-center gap-2 min-w-0 overflow-hidden">
					<PlayerAvatar color={playerColor as "white" | "black"} />
					<span className="text-xs font-semibold uppercase tracking-wider truncate">
						You · {playerColor}
					</span>
					<MaterialChip
						advantage={
							playerColor === "white"
								? whiteMaterial - blackMaterial
								: blackMaterial - whiteMaterial
						}
						label={playerColor ?? "your"}
					/>
					<CapturedIcons
						captured={playerColor === "white" ? capturedByWhite : capturedByBlack}
					/>
				</div>
				<div className="flex items-center gap-2 shrink-0">
					{inCheck && isMyTurn && status === "active" && (
						<span className="flex items-center gap-1 text-red-500 font-bold text-xs animate-pulse">
							<AlertTriangle size={10} />
							CHECK!
						</span>
					)}
					{status === "active" && !isMyTurn && (
						<span className="text-xs text-(--text-tertiary) italic">your turn next</span>
					)}
					{status === "finished" && (
						<span className="font-bold text-(--info) uppercase text-xs tracking-wide">
							{winner === "draw" ? "Draw!" : winner === playerColor ? "You win!" : "You lose"}
						</span>
					)}
				</div>
			</div>

			{/* ── Chat Panel ── */}
			<ChatPanel />

			{/* ── Action Bar ── */}
			<div className="shrink-0 flex items-center justify-between px-2.5 h-10 rounded-xl bg-(--bg-secondary) border border-(--border) gap-1.5 min-w-0 overflow-hidden">
				{/* Left: game actions */}
				<div className="flex items-center gap-1 shrink-0">
					<button
						onClick={() => setFlipped((f) => !f)}
						title="Flip board"
						className="p-1.5 rounded-lg text-(--text-tertiary) hover:text-(--text) hover:bg-(--bg-tertiary) transition-colors"
					>
						<RefreshCw size={13} />
					</button>
					{/* Move history playback (#112) */}
					{moveHistory.length > 0 && (
						<>
							<span className="w-px h-4 bg-(--border) mx-0.5" />
							<button
								onClick={() => setViewingIndex(0)}
								disabled={viewingIndex === 0}
								title="Jump to start (first move)"
								className="p-1.5 rounded-lg text-(--text-tertiary) hover:text-(--text) hover:bg-(--bg-tertiary) transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
							>
								<SkipBack size={13} />
							</button>
							<button
								onClick={() =>
									setViewingIndex(
										viewingIndex === null
											? moveHistory.length - 1
											: Math.max(0, viewingIndex - 1),
									)
								}
								disabled={viewingIndex === 0}
								title="Previous move (←)"
								className="p-1.5 rounded-lg text-(--text-tertiary) hover:text-(--text) hover:bg-(--bg-tertiary) transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
							>
								<ChevronLeft size={13} />
							</button>
							<span className="text-[10px] font-mono text-(--text-tertiary) tabular-nums shrink-0">
								{viewingIndex === null ? moveHistory.length : viewingIndex + 1}/
								{moveHistory.length}
							</span>
							<button
								onClick={() =>
									setViewingIndex(
										viewingIndex === null
											? null
											: Math.min(moveHistory.length - 1, viewingIndex + 1),
									)
								}
								disabled={viewingIndex === null}
								title="Next move (→)"
								className="p-1.5 rounded-lg text-(--text-tertiary) hover:text-(--text) hover:bg-(--bg-tertiary) transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
							>
								<ChevronRight size={13} />
							</button>
							<button
								onClick={() => setViewingIndex(null)}
								disabled={viewingIndex === null}
								title="Return to live position"
								className="p-1.5 rounded-lg text-(--text-tertiary) hover:text-(--text) hover:bg-(--bg-tertiary) transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
							>
								<SkipForward size={13} />
							</button>
						</>
					)}
					{status === "finished" ? (
						<button
							onClick={handleLeaveGame}
							className="px-3 py-1.5 bg-(--accent-dark) hover:bg-(--accent-primary) text-white rounded-lg flex items-center gap-1.5 text-xs font-semibold transition-colors"
						>
							<LogOut size={11} />
							Leave
						</button>
					) : status === "active" ? (
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
					) : null}
				</div>

				{/* Centre: timer */}
				{status === "active" && (
					<TurnTimer secondsLeft={secondsLeft} totalSeconds={timeControlSeconds} />
				)}

				{/* Right: escrow badge · sound · game code */}
				<div className="flex items-center gap-1 shrink-0 ml-auto">
					{/* Escrow status badge (wagered games only) */}
					{wagerAmount && (
						escrowStatus === "failed" ? (
							<span className="flex items-center gap-1 text-xs text-red-400 font-semibold">
								<AlertTriangle size={9} />
								<span className="hidden sm:inline">Escrow failed</span>
							</span>
						) : escrowStatus === "settled" ? (
							<a
								href={escrowResolveTx ? `${EXPLORER_BASE}${escrowResolveTx}` : undefined}
								target="_blank"
								rel="noopener noreferrer"
								className="flex items-center gap-1 text-xs text-green-400 font-semibold"
							>
								<CheckCircle2 size={9} />
								<span className="hidden sm:inline">Settled</span>
							</a>
						) : willReceiveTokens ? (
							<span className="flex items-center gap-1 text-xs text-yellow-400">
								<Loader2 size={9} className="animate-spin" />
								<span className="hidden sm:inline">Sending…</span>
							</span>
						) : (
							<span
								title={`Total pot: ${potDisplay}`}
								className="flex items-center gap-1 text-xs text-yellow-400/80 border border-yellow-500/25 rounded-md px-1.5 py-0.5"
							>
								<Lock size={8} />
								{potDisplay}
							</span>
						)
					)}
					<button
						onClick={toggleFullscreen}
						title={isFullscreen ? "Exit fullscreen (f)" : "Fullscreen (f)"}
						className="p-1.5 rounded-lg text-(--text-tertiary) hover:text-(--text) hover:bg-(--bg-tertiary) transition-colors"
					>
						{isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
					</button>
					<div className="relative flex items-center">
						<button
							onClick={() => setSoundEnabled(soundService.toggle())}
							onContextMenu={(e) => { e.preventDefault(); setShowVolumeSlider((v) => !v); }}
							title={soundEnabled ? "Mute sounds (right-click for volume)" : "Unmute sounds"}
							className="p-1.5 rounded-lg text-(--text-tertiary) hover:text-(--text) hover:bg-(--bg-tertiary) transition-colors"
						>
							{soundEnabled ? <Volume2 size={13} /> : <VolumeX size={13} />}
						</button>
						{showVolumeSlider && (
							<div className="absolute bottom-full right-0 mb-1 bg-(--bg-secondary) border border-(--border) rounded-lg p-2 shadow-xl z-50 flex flex-col items-center gap-1">
								<span className="text-[10px] text-(--text-tertiary)">Volume</span>
								<input
									type="range"
									min={0}
									max={1}
									step={0.05}
									value={volume}
									onChange={(e) => {
										const v = parseFloat(e.target.value);
										soundService.setVolume(v);
										setVolume(v);
									}}
									className="w-20 accent-(--accent-primary)"
								/>
								<span className="text-[10px] text-(--text-tertiary)">{Math.round(volume * 100)}%</span>
							</div>
						)}
					</div>
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
