import { useGameStore, useGameNotifications, useSoundEffects } from "../store/gameStore";
import { useToastStore } from "../store/toastStore";
import { soundService, type SoundPack } from "../services/soundService";
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
	Eye,
	Download,
	MessageCircle,
	ListOrdered,
	Settings as SettingsIcon,
	Palette,
	Crown,
	Sun,
	Moon,
	Laptop,
} from "lucide-react";
import {
	BOARD_THEMES,
	PIECE_SETS,
	useThemeStore,
} from "../store/themeStore";

const SOUND_PACKS: Array<{ key: SoundPack; name: string; description: string }> = [
	{ key: "wood", name: "Wood", description: "Classic wooden piece sounds" },
	{ key: "plastic", name: "Plastic", description: "Modern plastic piece sounds" },
	{ key: "arcade", name: "Arcade", description: "Retro arcade synth sounds" },
	{ key: "retro", name: "Retro 8-bit", description: "Classic chiptune sounds" },
];

const NATIVE_XLM = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const EXPLORER_BASE = "https://stellar.expert/explorer/testnet/tx/";

function tokenLabel(addr: string | null | undefined): string {
	if (!addr) return "XLM";
	if (addr === NATIVE_XLM) return "XLM";
	return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
import { useState, useMemo, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import type { AnnotationArrow, AnnotationColor, SquareHighlight } from "../types/chess";
import { getPossibleMoves, getCapturedPieces, materialAdvantage, moveToAlgebraic, movesToPgn } from "../utils/chessUtils";
import { getGameOutcome } from "../utils/gameResult";
import { squareAriaLabel } from "../utils/boardA11y";
import { socketService } from "../api/socket";
import PromotionModal from "./PromotionModal";
import ConfirmModal from "./ConfirmModal";
import GameResultModal from "./GameResultModal";
import TurnTimer from "./TurnTimer";
import ChatPanel from "./ChatPanel";
import MoveInputBar from "./MoveInputBar";

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

// ── Board annotation colors (#252) ─────────────────────────────────────────────
// Right-click plain = blue, Shift = green, Alt = red, Ctrl/Cmd = yellow.
const ANNOTATION_COLORS: Record<AnnotationColor, string> = {
	blue: "#3689e6",
	green: "#22ac38",
	red: "#e0403c",
	yellow: "#e6c729",
};

function colorFromModifiers(e: { shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }): AnnotationColor {
	if (e.shiftKey) return "green";
	if (e.altKey) return "red";
	if (e.ctrlKey || e.metaKey) return "yellow";
	return "blue";
}

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
		isBlindfoldMode,
		isStreamerMode,
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
	const [showResultModal, setShowResultModal] = useState(false);
	const [confirmAction, setConfirmAction] = useState<"resign" | "leave" | null>(null);
	const [soundEnabled, setSoundEnabled] = useState(() => (typeof soundService?.isEnabled === "function" ? soundService.isEnabled() : true));
	const [volume, setVolume] = useState(() => (typeof soundService?.getVolume === "function" ? soundService.getVolume() : 0.8));
	const [showVolumeSlider, setShowVolumeSlider] = useState(false);
	const [flipped, setFlipped] = useState(false);
	const [isPeeking, setIsPeeking] = useState(false);
	const peekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const [desktopTab, setDesktopTab] = useState<"moves" | "chat" | "settings">("moves");
	const [mobileTab, setMobileTab] = useState<"moves" | "chat" | "settings" | null>(null);

	const unreadCount = useGameStore((s) => s.unreadCount);
	const toggleBlindfoldMode = useGameStore((s) => s.toggleBlindfoldMode);
	const toggleStreamerMode = useGameStore((s) => s.toggleStreamerMode);

	const boardTheme = useThemeStore((s) => s.boardTheme);
	const setBoardTheme = useThemeStore((s) => s.setBoardTheme);
	const pieceSet = useThemeStore((s) => s.pieceSet);
	const setPieceSet = useThemeStore((s) => s.setPieceSet);
	const colorMode = useThemeStore((s) => s.colorMode);
	const setColorMode = useThemeStore((s) => s.setColorMode);
	const [soundPack, setSoundPack] = useState<SoundPack>(() => {
		return typeof soundService?.getSoundPack === "function" ? soundService.getSoundPack() : "wood";
	});

	const handleSoundPackChange = (pack: SoundPack) => {
		setSoundPack(pack);
		if (typeof soundService?.setSoundPack === "function") {
			soundService.setSoundPack(pack);
		}
	};

	const handleSoundPreview = (pack: SoundPack) => {
		if (typeof soundService?.getSoundPack !== "function" || typeof soundService?.setSoundPack !== "function") {
			soundService?.move?.();
			return;
		}
		const originalPack = soundService.getSoundPack();
		soundService.setSoundPack(pack);
		soundService.move?.();
		setTimeout(() => {
			if (typeof soundService?.setSoundPack === "function") {
				soundService.setSoundPack(originalPack);
			}
		}, 200);
	};

	const movePairs = useMemo(() => {
		const pairs: Array<{
			turnNumber: number;
			white?: (typeof moveHistory)[0];
			black?: (typeof moveHistory)[0];
			whiteIndex: number;
			blackIndex: number;
		}> = [];
		for (let i = 0; i < moveHistory.length; i += 2) {
			pairs.push({
				turnNumber: Math.floor(i / 2) + 1,
				white: moveHistory[i],
				black: moveHistory[i + 1],
				whiteIndex: i,
				blackIndex: i + 1,
			});
		}
		return pairs;
	}, [moveHistory]);

	// Focusable board grid container — receives keyboard focus for arrow-key
	// navigation/annotation shortcuts and drag/right-drag pointer tracking.
	const boardGridRef = useRef<HTMLDivElement>(null);

	// ── Keyboard-only move entry (#315) ─────────────────────────────────────
	// A square cursor roams the grid with the arrow keys; Space picks up or
	// drops a piece exactly like clicking the square. "/" or "M" focuses the
	// SAN command bar. Announcements go through a polite live region.
	const [cursor, setCursor] = useState<[number, number] | null>(null);
	const [boardAnnouncement, setBoardAnnouncement] = useState("");
	const moveInputRef = useRef<HTMLInputElement | null>(null);

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

	// ── Peek timer cleanup: cancel previous timer if peek is triggered again ────
	useEffect(() => {
		if (!isPeeking) {
			if (peekTimerRef.current !== null) {
				clearTimeout(peekTimerRef.current);
				peekTimerRef.current = null;
			}
			return;
		}

		// isPeeking is true: start/restart the 2-second timer
		peekTimerRef.current = setTimeout(() => {
			setIsPeeking(false);
			peekTimerRef.current = null;
		}, 2000);

		// Cleanup on unmount or if isPeeking becomes false
		return () => {
			if (peekTimerRef.current !== null) {
				clearTimeout(peekTimerRef.current);
				peekTimerRef.current = null;
			}
		};
	}, [isPeeking]);

	const handlePeekClick = () => {
		setIsPeeking(true);
	};

	const inCheck = useGameStore((s) => s.inCheck);
	const winner = useGameStore((s) => s.winner);
	const endReason = useGameStore((s) => s.endReason);
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
			? isStreamerMode
				? "•••• XLM"
				: `${parseFloat(String(wagerAmount)) * 2} ${tokenLabel(tokenAddress)}`
			: null;

	// Current player will receive tokens when game ends
	const willReceiveTokens =
		status === "finished" &&
		!!wagerAmount &&
		(winner === playerColor || winner === "draw");

	const gameOutcome = useMemo(
		() => getGameOutcome(winner, playerColor),
		[winner, playerColor],
	);

	const pgn = useMemo(() => {
		const algebraicMoves = moveHistory.map((m) =>
			moveToAlgebraic(m.from_position, m.to_position, m.promotion),
		);
		const resultTag =
			winner === "draw" ? "1/2-1/2" : winner === "white" ? "1-0" : winner === "black" ? "0-1" : "*";
		return movesToPgn(algebraicMoves, resultTag);
	}, [moveHistory, winner]);

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

	// ── Keyboard shortcuts ─────────────────────────────────────────────────────
	// Game actions (#131): Z steps back a move (undo/review), F flips the board,
	// Space focuses the board for keyboard play. Shift+F toggles fullscreen
	// (#124), and the arrow keys rewind/advance move review (#112). Shortcuts are
	// ignored while typing in an input, textarea, or contenteditable field.
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

			// Ignore combos we don't own (Ctrl/Cmd/Alt), except Shift+F below.
			if (e.ctrlKey || e.metaKey || e.altKey) return;

			const key = e.key.toLowerCase();

			// "/" or "M" jumps to the quick-move command bar (#315).
			if (key === "/" || key === "m") {
				e.preventDefault();
				setDesktopTab("moves");
				setMobileTab("moves");
				setTimeout(() => moveInputRef.current?.focus(), 50);
				return;
			}

			if (key === "f") {
				e.preventDefault();
				if (e.shiftKey) {
					toggleFullscreen();
				} else {
					setFlipped((prev) => !prev);
				}
				return;
			}

			if (e.shiftKey) return;

			if (key === "z") {
				// Undo / step one move back through the game's review history.
				e.preventDefault();
				if (moveHistory.length === 0) return;
				setViewingIndex(
					viewingIndex === null
						? Math.max(0, moveHistory.length - 2)
						: Math.max(0, viewingIndex - 1),
				);
				return;
			}

			if (e.key === " " || e.key === "Spacebar") {
				// Focus the board so arrow keys and square activation work.
				e.preventDefault();
				boardGridRef.current?.focus();
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
	}, [moveHistory.length, viewingIndex, setViewingIndex, setFlipped]);

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

	// Auto-open the post-game result modal (PGN copy, rematch, share) when the
	// game ends. Deferred to the (rarer) wagered-win case, which already gets
	// the more detailed PayoutModal above — showing both at once would stack
	// two full-screen overlays.
	useEffect(() => {
		if (status === "finished" && !willReceiveTokens) {
			const timer = setTimeout(() => setShowResultModal(true), 0);
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

	const handleRequestRematch = () => {
		if (!gameCode || !playerColor) return;
		socketService.requestRematch(gameCode, playerColor);
		addToast("Rematch request sent", "success");
	};

	const copyGameCode = async () => {
		if (!gameCode) return;
		await navigator.clipboard.writeText(gameCode);
		setCopied(true);
		setTimeout(() => setCopied(false), 1200);
	};

	// ── Keyboard square cursor (#315) ───────────────────────────────────────
	// Announces the square under the cursor (plus its legal destinations
	// while a piece is picked up) so screen-reader users can navigate the
	// grid without a mouse.
	const announceCursor = (row: number, col: number, pickedUp: boolean) => {
		const piece = board[row]?.[col] ?? ".";
		const base = squareAriaLabel(piece, row, col);
		if (!pickedUp) {
			setBoardAnnouncement(base);
			return;
		}
		const targets = getPossibleMoves(board, [row, col], playerColor!).map(
			([r, c]) => squareAriaLabel(board[r][c], r, c),
		);
		setBoardAnnouncement(
			targets.length > 0
				? `${base} picked up. Legal moves: ${targets.join(", ")}`
				: `${base} picked up. No legal moves.`,
		);
	};

	const moveCursor = (row: number, col: number) => {
		const clampedRow = Math.max(0, Math.min(7, row));
		const clampedCol = Math.max(0, Math.min(7, col));
		setCursor([clampedRow, clampedCol]);
		announceCursor(clampedRow, clampedCol, false);
	};

	// Shared by tap-to-move and drag-and-drop: attempts to move the piece on
	// `from` to `to`, opening the promotion modal if needed and giving a
	// short haptic tick on supported devices once the move lands (#253).
	const commitMove = async (
		from: [number, number],
		to: [number, number],
		promotion?: string,
	) => {
		const piece = board[from[0]][from[1]];
		const isPromotion = piece.toLowerCase() === "p" && (to[0] === 0 || to[0] === 7);

		if (isPromotion && !promotion) {
			setPromotionMove({ from, to });
			return;
		}

		setIsMoving(true);
		const toastId = addToast("Moving...", "loading");
		try {
			await makeMove(from, to, promotion);
			if ("vibrate" in navigator) navigator.vibrate(15);
		} catch (error: unknown) {
			addToast(friendlyError(error), "error");
			selectSquare(null);
		} finally {
			removeToast(toastId);
			setIsMoving(false);
		}
	};

	const handleSquareClick = async (row: number, col: number) => {
		// A plain left-click always clears any drawn arrows/highlights (#252).
		clearAnnotations();

		if (status !== "active" || currentTurn !== playerColor || isMoving) return;
		if (viewingIndex !== null) return;
		if (dragPiece) return; // a drag is in progress — its pointerup handles the drop

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

			await commitMove(selectedSquare, [row, col]);
		}
	};

	// ── Touch/mouse drag-and-drop (#253) ──────────────────────────────────────
	// Pieces can be picked up and dragged to a target square, in addition to
	// the tap-to-select / tap-to-move flow above. Pointer Events give us a
	// single API that covers mouse, touch and pen.
	const DRAG_THRESHOLD_PX = 6;
	const [dragPiece, setDragPiece] = useState<{
		row: number;
		col: number;
		piece: string;
		pointerId: number;
		pointerType: string;
		x: number;
		y: number;
	} | null>(null);
	const pendingDragRef = useRef<{
		row: number;
		col: number;
		piece: string;
		pointerId: number;
		pointerType: string;
		startX: number;
		startY: number;
	} | null>(null);

	const squareFromPoint = (clientX: number, clientY: number): [number, number] | null => {
		const el = boardGridRef.current;
		if (!el) return null;
		const rect = el.getBoundingClientRect();
		const x = clientX - rect.left;
		const y = clientY - rect.top;
		if (x < 0 || y < 0 || x >= rect.width || y >= rect.height) return null;
		const colIndex = Math.min(7, Math.floor((x / rect.width) * 8));
		const rowIndex = Math.min(7, Math.floor((y / rect.height) * 8));
		const actualRow = playerColor === "black" ? 7 - rowIndex : rowIndex;
		const actualCol = playerColor === "black" ? 7 - colIndex : colIndex;
		return [actualRow, actualCol];
	};

	const handlePiecePointerDown = (e: React.PointerEvent, row: number, col: number) => {
		if (e.pointerType === "mouse" && e.button !== 0) return;
		if (status !== "active" || currentTurn !== playerColor || isMoving) return;
		if (viewingIndex !== null) return;
		const piece = board[row][col];
		if (piece === "." || !isPlayerPiece(piece)) return;

		pendingDragRef.current = {
			row,
			col,
			piece,
			pointerId: e.pointerId,
			pointerType: e.pointerType,
			startX: e.clientX,
			startY: e.clientY,
		};
	};

	const handleBoardPointerMove = (e: React.PointerEvent) => {
		const pending = pendingDragRef.current;
		if (pending && pending.pointerId === e.pointerId && !dragPiece) {
			const dx = e.clientX - pending.startX;
			const dy = e.clientY - pending.startY;
			if (Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) {
				(e.target as HTMLElement).setPointerCapture?.(e.pointerId);
				if (pending.pointerType === "touch" && "vibrate" in navigator) navigator.vibrate(10);
				selectSquare([pending.row, pending.col]);
				setDragPiece({
					row: pending.row,
					col: pending.col,
					piece: pending.piece,
					pointerId: pending.pointerId,
					pointerType: pending.pointerType,
					x: e.clientX,
					y: e.clientY,
				});
			}
			return;
		}
		if (dragPiece && dragPiece.pointerId === e.pointerId) {
			setDragPiece((prev) => (prev ? { ...prev, x: e.clientX, y: e.clientY } : prev));
		}
	};

	const endDrag = async (e: React.PointerEvent) => {
		const pending = pendingDragRef.current;
		if (pending && pending.pointerId === e.pointerId) {
			pendingDragRef.current = null;
		}
		if (!dragPiece || dragPiece.pointerId !== e.pointerId) return;

		const from: [number, number] = [dragPiece.row, dragPiece.col];
		const target = squareFromPoint(e.clientX, e.clientY);
		setDragPiece(null);

		if (!target) return;
		const [toRow, toCol] = target;
		if (toRow === from[0] && toCol === from[1]) return;

		const targetPiece = board[toRow][toCol];
		if (targetPiece !== "." && isPlayerPiece(targetPiece)) {
			selectSquare([toRow, toCol]);
			return;
		}

		await commitMove(from, [toRow, toCol]);
	};

	const handlePointerCancel = (e: React.PointerEvent) => {
		if (pendingDragRef.current?.pointerId === e.pointerId) pendingDragRef.current = null;
		if (dragPiece?.pointerId === e.pointerId) setDragPiece(null);
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
	const [boardPx, setBoardPx] = useState(480);
	useEffect(() => {
		const el = boardWrapperRef.current;
		if (!el) return;
		const update = () => {
			const size = Math.min(el.clientWidth, el.clientHeight);
			if (size > 0) setBoardPx(size);
		};
		update();
		if (typeof ResizeObserver === "undefined") return;
		const obs = new ResizeObserver(update);
		obs.observe(el);
		return () => obs.disconnect();
	}, []);

	// ── Board annotations: right-click highlights & arrows (#252) ────────────
	const [highlights, setHighlights] = useState<SquareHighlight[]>([]);
	const [arrows, setArrows] = useState<AnnotationArrow[]>([]);
	const rightDragRef = useRef<{ row: number; col: number; color: AnnotationColor } | null>(null);

	const squareFromClientPoint = (clientX: number, clientY: number): [number, number] | null => {
		const el = boardGridRef.current;
		if (!el) return null;
		const rect = el.getBoundingClientRect();
		const x = clientX - rect.left;
		const y = clientY - rect.top;
		if (x < 0 || y < 0 || x >= rect.width || y >= rect.height) return null;
		const colIndex = Math.min(7, Math.floor((x / rect.width) * 8));
		const rowIndex = Math.min(7, Math.floor((y / rect.height) * 8));
		const row = playerColor === "black" ? 7 - rowIndex : rowIndex;
		const col = playerColor === "black" ? 7 - colIndex : colIndex;
		return [row, col];
	};

	const clearAnnotations = () => {
		setHighlights((prev) => (prev.length ? [] : prev));
		setArrows((prev) => (prev.length ? [] : prev));
	};

	const toggleHighlight = (row: number, col: number, color: AnnotationColor) => {
		setHighlights((prev) => {
			const idx = prev.findIndex((h) => h.row === row && h.col === col);
			if (idx === -1) return [...prev, { row, col, color }];
			if (prev[idx].color === color) return prev.filter((_, i) => i !== idx);
			const next = [...prev];
			next[idx] = { row, col, color };
			return next;
		});
	};

	const toggleArrow = (
		fromRow: number,
		fromCol: number,
		toRow: number,
		toCol: number,
		color: AnnotationColor,
	) => {
		setArrows((prev) => {
			const idx = prev.findIndex(
				(a) => a.from[0] === fromRow && a.from[1] === fromCol && a.to[0] === toRow && a.to[1] === toCol,
			);
			if (idx === -1) return [...prev, { from: [fromRow, fromCol], to: [toRow, toCol], color }];
			if (prev[idx].color === color) return prev.filter((_, i) => i !== idx);
			const next = [...prev];
			next[idx] = { from: [fromRow, fromCol], to: [toRow, toCol], color };
			return next;
		});
	};

	const handleSquareMouseDown = (e: React.MouseEvent, row: number, col: number) => {
		if (e.button !== 2) return; // only the right mouse button draws annotations
		e.preventDefault();
		rightDragRef.current = { row, col, color: colorFromModifiers(e) };
	};

	const handleBoardMouseUp = (e: React.MouseEvent) => {
		if (e.button !== 2) return;
		const start = rightDragRef.current;
		rightDragRef.current = null;
		if (!start) return;
		const target = squareFromClientPoint(e.clientX, e.clientY);
		if (!target) return;
		const [row, col] = target;
		if (row === start.row && col === start.col) {
			toggleHighlight(row, col, start.color);
		} else {
			toggleArrow(start.row, start.col, row, col, start.color);
		}
	};

	// Square center in on-screen pixels, respecting the board's flip state,
	// for positioning the SVG annotation overlay.
	const squareCenterPx = (row: number, col: number) => {
		const rowIndex = playerColor === "black" ? 7 - row : row;
		const colIndex = playerColor === "black" ? 7 - col : col;
		const squareSize = boardPx / 8;
		return { x: colIndex * squareSize + squareSize / 2, y: rowIndex * squareSize + squareSize / 2 };
	};

	const displayBoard =
		(playerColor === "black") !== flipped
			? [...viewingBoard].reverse().map((row) => [...row].reverse())
			: viewingBoard;

	const opponentColor = playerColor === "white" ? "black" : "white";
	const isMyTurn = currentTurn === playerColor;

	// ── Render Settings Content (shared between Desktop tab and Mobile drawer) ──
	const renderSettingsContent = () => (
		<div className="flex flex-col gap-4 p-3 text-xs overflow-y-auto">
			{/* Board Themes */}
			<div className="flex flex-col gap-2">
				<span className="font-semibold text-(--text-secondary) flex items-center gap-1.5">
					<Palette size={13} /> Board Theme
				</span>
				<div className="grid grid-cols-2 gap-1.5">
					{BOARD_THEMES.map((theme) => (
						<button
							key={theme.key}
							onClick={() => setBoardTheme(theme.key)}
							className={`flex items-center gap-2 p-2 rounded-xl border text-left transition-all ${
								boardTheme === theme.key
									? "border-(--accent-primary) bg-(--accent-primary)/10 text-(--text)"
									: "border-(--border) bg-(--bg) text-(--text-secondary) hover:text-(--text) hover:border-gray-500/50"
							}`}
						>
							<span
								className="w-4 h-4 rounded-md shrink-0 border border-black/20"
								style={{ background: theme.preview }}
							/>
							<span className="truncate font-medium">{theme.name}</span>
						</button>
					))}
				</div>
			</div>

			{/* Piece Sets */}
			<div className="flex flex-col gap-2">
				<span className="font-semibold text-(--text-secondary) flex items-center gap-1.5">
					<Crown size={13} /> Piece Set
				</span>
				<div className="grid grid-cols-2 gap-1.5">
					{PIECE_SETS.map((set) => (
						<button
							key={set.key}
							onClick={() => setPieceSet(set.key)}
							className={`flex items-center justify-between p-2 rounded-xl border text-left transition-all ${
								pieceSet === set.key
									? "border-(--accent-primary) bg-(--accent-primary)/10 text-(--text)"
									: "border-(--border) bg-(--bg) text-(--text-secondary) hover:text-(--text) hover:border-gray-500/50"
							}`}
						>
							<span className="truncate font-medium">{set.name}</span>
							<span className="text-sm font-serif">{set.pieces.K}</span>
						</button>
					))}
				</div>
			</div>

			{/* Sound Pack */}
			<div className="flex flex-col gap-2">
				<span className="font-semibold text-(--text-secondary) flex items-center gap-1.5">
					<Volume2 size={13} /> Sound Pack
				</span>
				<div className="flex flex-col gap-1.5">
					{SOUND_PACKS.map((pack) => (
						<div
							key={pack.key}
							className={`flex items-center justify-between p-2 rounded-xl border transition-all ${
								soundPack === pack.key
									? "border-(--accent-primary) bg-(--accent-primary)/10 text-(--text)"
									: "border-(--border) bg-(--bg) text-(--text-secondary) hover:text-(--text)"
							}`}
						>
							<button
								onClick={() => handleSoundPackChange(pack.key)}
								className="flex-1 text-left flex flex-col min-w-0"
							>
								<span className="font-medium">{pack.name}</span>
								<span className="text-[10px] text-(--text-tertiary) truncate">{pack.description}</span>
							</button>
							<button
								onClick={() => handleSoundPreview(pack.key)}
								title="Preview sound"
								className="p-1.5 rounded-lg text-(--text-tertiary) hover:text-(--text) hover:bg-(--bg-tertiary) transition-colors shrink-0"
							>
								<Volume2 size={13} />
							</button>
						</div>
					))}
				</div>
			</div>

			{/* Game Mode Toggles */}
			<div className="flex flex-col gap-2 pt-2 border-t border-(--border)">
				<span className="font-semibold text-(--text-secondary)">Display & Options</span>

				{/* Blindfold Mode */}
				<div className="flex items-center justify-between p-2 rounded-xl bg-(--bg) border border-(--border)">
					<div className="flex flex-col">
						<span className="font-medium text-(--text)">Blindfold Mode</span>
						<span className="text-[10px] text-(--text-tertiary)">Hide pieces to train visualization</span>
					</div>
					<button
						onClick={toggleBlindfoldMode}
						className={`w-9 h-5 flex items-center rounded-full p-0.5 transition-colors ${
							isBlindfoldMode ? "bg-(--accent-primary) justify-end" : "bg-gray-600 justify-start"
						}`}
					>
						<span className="w-4 h-4 rounded-full bg-white shadow-sm" />
					</button>
				</div>

				{/* Streamer Mode */}
				<div className="flex items-center justify-between p-2 rounded-xl bg-(--bg) border border-(--border)">
					<div className="flex flex-col">
						<span className="font-medium text-(--text)">Streamer Mode</span>
						<span className="text-[10px] text-(--text-tertiary)">Large coordinates & high visibility</span>
					</div>
					<button
						onClick={toggleStreamerMode}
						className={`w-9 h-5 flex items-center rounded-full p-0.5 transition-colors ${
							isStreamerMode ? "bg-(--accent-primary) justify-end" : "bg-gray-600 justify-start"
						}`}
					>
						<span className="w-4 h-4 rounded-full bg-white shadow-sm" />
					</button>
				</div>

				{/* Color Mode */}
				<div className="flex items-center justify-between p-2 rounded-xl bg-(--bg) border border-(--border)">
					<span className="font-medium text-(--text)">Theme Mode</span>
					<div className="flex items-center gap-1 bg-(--bg-secondary) p-1 rounded-lg border border-(--border)">
						<button
							onClick={() => setColorMode("light")}
							className={`p-1 rounded ${colorMode === "light" ? "bg-(--accent-primary) text-white" : "text-(--text-tertiary)"}`}
							title="Light"
						>
							<Sun size={12} />
						</button>
						<button
							onClick={() => setColorMode("dark")}
							className={`p-1 rounded ${colorMode === "dark" ? "bg-(--accent-primary) text-white" : "text-(--text-tertiary)"}`}
							title="Dark"
						>
							<Moon size={12} />
						</button>
						<button
							onClick={() => setColorMode("system")}
							className={`p-1 rounded ${colorMode === "system" ? "bg-(--accent-primary) text-white" : "text-(--text-tertiary)"}`}
							title="System"
						>
							<Laptop size={12} />
						</button>
					</div>
				</div>
			</div>
		</div>
	);

	// ── Render Moves Content (shared between Desktop tab and Mobile drawer) ──
	const formatNotation = (m?: (typeof moveHistory)[0] | null) => {
		if (!m) return "";
		return `${moveToAlgebraic(m.from_position, m.to_position, m.promotion)}${m.is_checkmate ? "#" : m.is_check ? "+" : ""}`;
	};

	const renderMovesContent = (isMobile = false) => (
		<div className="flex flex-col h-full overflow-hidden">
			{/* Moves Table */}
			<div className="flex-1 min-h-0 overflow-y-auto p-2">
				{movePairs.length === 0 ? (
					<div className="h-full flex items-center justify-center text-xs text-(--text-tertiary)">
						No moves yet. Make the first move!
					</div>
				) : (
					<div className="flex flex-col text-xs font-mono">
						{movePairs.map((pair) => (
							<div key={pair.turnNumber} className="flex items-center py-1 px-2 rounded hover:bg-(--bg-tertiary) transition-colors">
								<span className="w-8 text-(--text-tertiary) font-semibold select-none">{pair.turnNumber}.</span>
								<button
									onClick={() => setViewingIndex(pair.whiteIndex)}
									className={`flex-1 text-left px-1.5 py-0.5 rounded transition-colors ${
										viewingIndex === pair.whiteIndex ? "bg-(--accent-primary) text-white font-bold" : "text-(--text) hover:bg-(--bg)"
									}`}
								>
									{formatNotation(pair.white)}
								</button>
								{pair.black ? (
									<button
										onClick={() => setViewingIndex(pair.blackIndex)}
										className={`flex-1 text-left px-1.5 py-0.5 rounded transition-colors ${
											viewingIndex === pair.blackIndex ? "bg-(--accent-primary) text-white font-bold" : "text-(--text) hover:bg-(--bg)"
										}`}
									>
										{formatNotation(pair.black)}
									</button>
								) : (
									<span className="flex-1" />
								)}
							</div>
						))}
					</div>
				)}
			</div>

			{/* Playback Controls Toolbar */}
			<div className="shrink-0 flex items-center justify-center gap-1.5 p-2 border-t border-(--border) bg-(--bg)">
				<button
					onClick={() => setViewingIndex(0)}
					disabled={viewingIndex === 0 || moveHistory.length === 0}
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
					disabled={viewingIndex === 0 || moveHistory.length === 0}
					title="Previous move (←)"
					className="p-1.5 rounded-lg text-(--text-tertiary) hover:text-(--text) hover:bg-(--bg-tertiary) transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
				>
					<ChevronLeft size={13} />
				</button>
				<span className="text-[11px] font-mono text-(--text-tertiary) tabular-nums px-2 shrink-0">
					{viewingIndex === null ? moveHistory.length : viewingIndex + 1} / {moveHistory.length}
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
			</div>

			{/* Docked MoveInputBar */}
			<div className="shrink-0 p-2 border-t border-(--border)">
				<MoveInputBar
					board={board}
					turn={playerColor!}
					isPlayerTurn={isMyTurn && status === "active" && viewingIndex === null}
					onMove={commitMove}
					focusRef={isMobile ? undefined : moveInputRef}
				/>
			</div>
		</div>
	);

	return (
		<div className="h-full w-full max-h-dvh max-w-dvw overflow-hidden flex flex-col bg-(--bg) select-none p-1 sm:p-2 gap-1 sm:gap-2">
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

			{/* ── Post-Game Result Modal ── */}
			{showResultModal && status === "finished" && (
				<GameResultModal
					outcome={gameOutcome}
					endReason={endReason}
					gameCode={gameCode}
					pgn={pgn}
					txHash={escrowResolveTx}
					onRematch={handleRequestRematch}
					onClose={() => setShowResultModal(false)}
				/>
			)}


			{/* ── Screen-reader announcements (#315) ── */}
			<div role="status" aria-live="polite" className="sr-only">{boardAnnouncement}</div>

			{/* ── Top Header Bar ── */}
			<header className="shrink-0 h-11 sm:h-12 px-2.5 sm:px-3 rounded-xl bg-(--bg-secondary) border border-(--border) flex items-center justify-between gap-2 min-w-0 overflow-hidden shadow-xs">
				{/* Left: Brand, Game Code, Escrow Badge */}
				<div className="flex items-center gap-2 min-w-0">
					<div className="flex items-center gap-1.5 shrink-0">
						<span className="text-base sm:text-lg select-none">♟️</span>
						<span className="hidden sm:inline font-black text-xs sm:text-sm tracking-widest text-(--text-primary)">
							CHESSTER
						</span>
					</div>

					<button
						onClick={copyGameCode}
						disabled={!gameCode}
						title="Copy game code"
						className="flex items-center gap-1.5 px-2.5 py-1 bg-(--bg-tertiary) hover:bg-gray-600/40 text-(--text-secondary) hover:text-(--text) rounded-lg text-xs font-mono transition-colors disabled:opacity-40 shrink-0"
					>
						{copied ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
						<span>{gameCode}</span>
					</button>

					{/* Escrow status badge (wagered games only) */}
					{wagerAmount && (
						escrowStatus === "failed" ? (
							<span className="flex items-center gap-1 text-xs text-red-400 font-semibold px-2 py-0.5 rounded-md bg-red-500/10 border border-red-500/20 shrink-0">
								<AlertTriangle size={11} />
								<span className="hidden md:inline">Escrow failed</span>
							</span>
						) : escrowStatus === "settled" ? (
							<a
								href={escrowResolveTx ? `${EXPLORER_BASE}${escrowResolveTx}` : undefined}
								target="_blank"
								rel="noopener noreferrer"
								className="flex items-center gap-1 text-xs text-green-400 font-semibold px-2 py-0.5 rounded-md bg-green-500/10 border border-green-500/20 shrink-0"
							>
								<CheckCircle2 size={11} />
								<span className="hidden md:inline">Settled</span>
							</a>
						) : willReceiveTokens ? (
							<span className="flex items-center gap-1 text-xs text-yellow-400 px-2 py-0.5 rounded-md bg-yellow-500/10 border border-yellow-500/20 shrink-0">
								<Loader2 size={11} className="animate-spin" />
								<span className="hidden md:inline">Sending…</span>
							</span>
						) : (
							<span
								title={`Total pot: ${potDisplay}`}
								className="flex items-center gap-1 text-xs text-yellow-400/90 border border-yellow-500/25 rounded-md px-2 py-0.5 bg-yellow-500/10 font-medium shrink-0"
							>
								<Lock size={10} />
								<span>{potDisplay}</span>
							</span>
						)
					)}
				</div>

				{/* Right: Quick Controls */}
				<div className="flex items-center gap-1 shrink-0">
					{/* Peek button - only show when blindfold mode is active */}
					{isBlindfoldMode && (
						<button
							onClick={handlePeekClick}
							disabled={isPeeking}
							title={isPeeking ? "Peeking... (2 seconds)" : "Peek at pieces (2 seconds)"}
							className={`p-1.5 sm:p-2 rounded-lg transition-colors ${
								isPeeking
									? "bg-(--accent-primary) text-white"
									: "text-(--text-tertiary) hover:text-(--text) hover:bg-(--bg-tertiary)"
							}`}
						>
							<Eye size={15} />
						</button>
					)}

					<button
						onClick={() => setFlipped((f) => !f)}
						title="Flip board"
						className="p-1.5 sm:p-2 rounded-lg text-(--text-tertiary) hover:text-(--text) hover:bg-(--bg-tertiary) transition-colors"
					>
						<RefreshCw size={15} />
					</button>

					<div className="relative flex items-center">
						<button
							onClick={() => setSoundEnabled(soundService.toggle())}
							onContextMenu={(e) => { e.preventDefault(); setShowVolumeSlider((v) => !v); }}
							title={soundEnabled ? "Mute sounds (right-click for volume)" : "Unmute sounds"}
							className="p-1.5 sm:p-2 rounded-lg text-(--text-tertiary) hover:text-(--text) hover:bg-(--bg-tertiary) transition-colors"
						>
							{soundEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
						</button>
						{showVolumeSlider && (
							<div className="absolute top-full right-0 mt-1.5 bg-(--bg-secondary) border border-(--border) rounded-xl p-2.5 shadow-2xl z-50 flex flex-col items-center gap-1.5 min-w-[120px]">
								<div className="flex items-center justify-between w-full text-[10px] text-(--text-tertiary)">
									<span>Volume</span>
									<span className="font-mono">{Math.round(volume * 100)}%</span>
								</div>
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
									className="w-full accent-(--accent-primary)"
								/>
							</div>
						)}
					</div>

					<button
						onClick={toggleFullscreen}
						title={isFullscreen ? "Exit fullscreen (f)" : "Fullscreen (f)"}
						className="p-1.5 sm:p-2 rounded-lg text-(--text-tertiary) hover:text-(--text) hover:bg-(--bg-tertiary) transition-colors"
					>
						{isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
					</button>

					<button
						onClick={() => {
							setDesktopTab("settings");
							setMobileTab("settings");
						}}
						title="Settings & Themes"
						className="p-1.5 sm:p-2 rounded-lg text-(--text-tertiary) hover:text-(--text) hover:bg-(--bg-tertiary) transition-colors"
					>
						<SettingsIcon size={15} />
					</button>
				</div>
			</header>

			{/* ── Main Workspace Area ── */}
			<div className="flex-1 min-h-0 min-w-0 flex flex-col lg:flex-row gap-2 lg:gap-3 overflow-hidden">
				{/* Center Chess Arena */}
				<div className="flex-1 min-h-0 min-w-0 flex flex-col items-center justify-between overflow-hidden gap-1 sm:gap-1.5">
					{/* Opponent Bar */}
					<div
						className="shrink-0 flex items-center justify-between px-3 h-10 rounded-xl bg-(--bg-secondary) border border-(--border) min-w-0 gap-2 transition-[width] duration-150"
						style={{ width: boardPx > 0 ? `${boardPx}px` : "100%", maxWidth: "100%" }}
					>
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
					ref={boardGridRef}
					role="grid"
					tabIndex={-1}
					aria-label={`Chess board, ${moveHistory.length} moves played. Use the move input bar to type moves, arrow keys to move the square cursor, Enter to pick up or place, Z to step back, F to flip the board.`}
					className={`relative rounded-sm overflow-hidden shadow-2xl transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 ${isMoving ? "opacity-70" : "opacity-100"}`}
					style={
						{
							width: boardPx,
							height: boardPx,
							display: "grid",
							gridTemplateColumns: "repeat(8, 1fr)",
							gridTemplateRows: "repeat(8, 1fr)",
							"--board-size": `${boardPx}px`,
							touchAction: "none",
						} as React.CSSProperties
					}
					onContextMenu={(e) => e.preventDefault()}
					onMouseUp={handleBoardMouseUp}
					onMouseLeave={() => {
						rightDragRef.current = null;
					}}
					onPointerMove={handleBoardPointerMove}
					onPointerUp={endDrag}
					onPointerCancel={handlePointerCancel}
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
						const isDragSource =
							dragPiece !== null && dragPiece.row === actualRow && dragPiece.col === actualCol;

						const isCursor = cursor !== null && cursor[0] === actualRow && cursor[1] === actualCol;

						return (
							<div
								key={`${rowIndex}-${colIndex}`}
								data-testid={`square-${actualRow}-${actualCol}`}
								role="gridcell"
								tabIndex={0}
								aria-label={squareAriaLabel(piece, actualRow, actualCol)}
								aria-selected={selected === true || isCursor}
								className={`board-square relative flex items-center justify-center cursor-pointer transition-[filter] hover:brightness-110 focus-visible:outline-2 focus-visible:outline-blue-400 focus-visible:-outline-offset-2 ${
									isLight ? "bg-(--sq-light)" : "bg-(--sq-dark)"
								} ${selected ? "square-selected bg-yellow-400/75" : ""} ${
									isKingInCheck ? "square-check bg-red-500/80" : ""
								} ${isLastMoveSquare ? "square-last-move bg-yellow-300/45" : ""} ${
									highlight ? " outline-2 outline-yellow-300/60 -outline-offset-2" : ""
								} ${isCursor ? "outline-2 outline-sky-400 -outline-offset-2" : ""}`}
								style={isCaptureSquare ? { animation: "captureFlash 0.4s ease-out forwards" } : undefined}
								onClick={() => handleSquareClick(actualRow, actualCol)}
								onKeyDown={(e) => {
									// Arrow keys move the square cursor (#315); the cursor is
									// clamped to the grid so screen-reader users never lose
									// their position.
									if (
										e.key === "ArrowUp" ||
										e.key === "ArrowDown" ||
										e.key === "ArrowLeft" ||
										e.key === "ArrowRight"
									) {
										e.preventDefault();
										e.stopPropagation();
										const dRow = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
										const dCol = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
										moveCursor(actualRow + dRow, actualCol + dCol);
										return;
									}
									// Enter/Space activate a square, mirroring a click, so the
									// board is fully playable from the keyboard (#134, #315).
									if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
										e.preventDefault();
										setCursor([actualRow, actualCol]);
										announceCursor(actualRow, actualCol, false);
										handleSquareClick(actualRow, actualCol);
									}
								}}
								onTouchEnd={(e) => {
									// Prevent the synthetic click that follows touch so the
									// handler doesn't fire twice on mobile browsers.
									e.preventDefault();
									handleSquareClick(actualRow, actualCol);
								}}
								onMouseDown={(e) => handleSquareMouseDown(e, actualRow, actualCol)}
								onPointerDown={(e) => handlePiecePointerDown(e, actualRow, actualCol)}
							>
								{/* Rank number on leftmost squares */}
								{actualCol === 0 && (
									<span className={`absolute top-0.5 left-1 font-bold pointer-events-none select-none z-10 ${isStreamerMode ? "text-sm sm:text-base text-yellow-300 font-extrabold" : "text-[10px] text-gray-500 dark:text-gray-400 opacity-75"}`}>
										{playerColor === "black" ? actualRow + 1 : 8 - actualRow}
									</span>
								)}
								{/* File letter on bottommost squares */}
								{actualRow === 7 && (
									<span className={`absolute bottom-0.5 right-1 font-bold pointer-events-none select-none z-10 ${isStreamerMode ? "text-sm sm:text-base text-yellow-300 font-extrabold" : "text-[10px] text-gray-500 dark:text-gray-400 opacity-75"}`}>
										{String.fromCharCode(97 + (playerColor === "black" ? 7 - actualCol : actualCol))}
									</span>
								)}
								{/* Legal-move marker: dot on empty squares, ring on captures (#123) */}
								{possible && !capture && (
									<div
										className="legal-move-dot absolute rounded-full bg-black/30 dark:bg-white/25 pointer-events-none"
										style={{
											width: "calc(var(--board-size) / 8 * 0.32)",
											height: "calc(var(--board-size) / 8 * 0.32)",
										}}
									/>
								)}
								{capture && (
									<div
										className="legal-move-ring absolute rounded-full border-[3px] border-yellow-400/90 pointer-events-none"
										style={{
											width: "calc(var(--board-size) / 8 * 0.72)",
											height: "calc(var(--board-size) / 8 * 0.72)",
										}}
									/>
								)}
								{/* Piece */}
								{piece !== "." && (
									<>
										{isBlindfoldMode && !isPeeking ? (
											// Blindfold mode: render subtle dot instead of piece
											<div
												className="absolute rounded-full bg-black/40 dark:bg-white/30 pointer-events-none"
												style={{
													width: "calc(var(--board-size) / 8 * 0.18)",
													height: "calc(var(--board-size) / 8 * 0.18)",
												}}
											/>
										) : (
											// Normal mode or peeking: render piece SVG
											<span
												key={isPieceAnimating ? "anim" : "static"}
												className="leading-none pointer-events-none"
												style={{
													fontSize: "calc(var(--board-size) / 8 * 0.72)",
													opacity: isDragSource ? 0.35 : 1,
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
									</>
								)}
							</div>
						);
					}),
				)}
				{/* Right-click annotation overlay: arrows & square highlights (#252) */}
				{(arrows.length > 0 || highlights.length > 0) && (
					<svg
						className="absolute inset-0 pointer-events-none"
						width={boardPx}
						height={boardPx}
						style={{ zIndex: 5 }}
					>
						<defs>
							{(Object.keys(ANNOTATION_COLORS) as AnnotationColor[]).map((color) => (
								<marker
									key={color}
									id={`board-arrowhead-${color}`}
									markerWidth="4"
									markerHeight="4"
									refX="2"
									refY="2"
									orient="auto-start-reverse"
									markerUnits="strokeWidth"
								>
									<path d="M0,0 L4,2 L0,4 Z" fill={ANNOTATION_COLORS[color]} />
								</marker>
							))}
						</defs>
						{highlights.map((h, i) => {
							const c = squareCenterPx(h.row, h.col);
							const squareSize = boardPx / 8;
							return (
								<circle
									key={`h-${i}`}
									cx={c.x}
									cy={c.y}
									r={squareSize * 0.44}
									fill="none"
									stroke={ANNOTATION_COLORS[h.color]}
									strokeWidth={squareSize * 0.08}
									opacity={0.85}
								/>
							);
						})}
						{arrows.map((a, i) => {
							const from = squareCenterPx(a.from[0], a.from[1]);
							const to = squareCenterPx(a.to[0], a.to[1]);
							const squareSize = boardPx / 8;
							// Pull the line end back so the arrowhead doesn't sit under the piece.
							const dx = to.x - from.x;
							const dy = to.y - from.y;
							const len = Math.hypot(dx, dy) || 1;
							const shorten = squareSize * 0.4;
							const endX = to.x - (dx / len) * shorten;
							const endY = to.y - (dy / len) * shorten;
							return (
								<line
									key={`a-${i}`}
									x1={from.x}
									y1={from.y}
									x2={endX}
									y2={endY}
									stroke={ANNOTATION_COLORS[a.color]}
									strokeWidth={squareSize * 0.14}
									strokeLinecap="round"
									opacity={0.85}
									markerEnd={`url(#board-arrowhead-${a.color})`}
								/>
							);
						})}
					</svg>
				)}
				</div>
				)}
				{/* Dragged piece follows the pointer, elevated above the board (#253) */}
				{dragPiece && boardPx > 0 && (
					<span
						className="fixed leading-none pointer-events-none z-50"
						style={{
							left: dragPiece.x,
							top: dragPiece.y,
							fontSize: `calc(${boardPx}px / 8 * 0.72)`,
							transform:
								dragPiece.pointerType === "touch"
									? "translate(-50%, -50%) scale(1.2) translateY(-10px)"
									: "translate(-50%, -50%) scale(1.1)",
							filter: "drop-shadow(0 6px 8px rgb(0 0 0 / 0.45))",
							transition: "transform 0.1s ease-out",
							...(dragPiece.piece === dragPiece.piece.toUpperCase()
								? WHITE_PIECE_STYLE
								: BLACK_PIECE_STYLE),
						} as React.CSSProperties}
					>
						{PIECE_SYMBOLS[dragPiece.piece]}
					</span>
				)}
			</div>


					{/* Player Bar */}
					<div
						className="shrink-0 flex items-center justify-between px-3 h-10 rounded-xl bg-(--bg-secondary) border border-(--border) min-w-0 gap-2 transition-[width] duration-150"
						style={{ width: boardPx > 0 ? `${boardPx}px` : "100%", maxWidth: "100%" }}
					>
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
									<AlertTriangle size={11} />
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

					{/* Mobile Quick Controls Bar */}
					<div
						className="lg:hidden shrink-0 flex items-center justify-between px-2 h-10 rounded-xl bg-(--bg-secondary) border border-(--border) gap-1.5 transition-[width] duration-150"
						style={{ width: boardPx > 0 ? `${boardPx}px` : "100%", maxWidth: "100%" }}
					>
						{status === "active" ? (
							<TurnTimer 
								secondsLeft={secondsLeft} 
								totalSeconds={timeControlSeconds}
								isCurrentTurn={playerColor === currentTurn}
							/>
						) : (
							<span className="text-xs font-semibold uppercase text-(--text-tertiary) px-2">
								{status === "finished" ? "Game Over" : "Ready"}
							</span>
						)}

						<div className="flex items-center gap-1">
							{status === "active" && (
								<>
									<button
										onClick={handleResign}
										title="Resign game"
										className="px-2 py-1 bg-red-500/15 hover:bg-red-500 text-red-400 hover:text-white rounded-lg flex items-center gap-1 text-xs transition-colors"
									>
										<Flag size={11} />
										<span className="hidden sm:inline">Resign</span>
									</button>
									{drawOffer !== playerColor && (
										<button
											onClick={handleOfferDraw}
											title="Offer draw"
											className="px-2 py-1 bg-blue-500/15 hover:bg-blue-500 text-blue-400 hover:text-white rounded-lg flex items-center gap-1 text-xs transition-colors"
										>
											<Handshake size={11} />
											<span className="hidden sm:inline">Draw</span>
										</button>
									)}
									{drawOffer && drawOffer !== playerColor && (
										<button
											onClick={handleAcceptDraw}
											title="Accept draw"
											className="px-2 py-1 bg-green-500 hover:bg-green-600 text-white rounded-lg flex items-center gap-1 text-xs transition-colors animate-pulse"
										>
											<Handshake size={11} />
											<span>Accept</span>
										</button>
									)}
								</>
							)}

							{status === "finished" && (
								<>
									<button
										onClick={() => setShowResultModal(true)}
										className="px-2 py-1 bg-purple-500/15 hover:bg-purple-500 text-purple-400 hover:text-white rounded-lg flex items-center gap-1 text-xs transition-colors"
									>
										<Download size={11} />
										<span>Share</span>
									</button>
									<button
										onClick={handleLeaveGame}
										className="px-2.5 py-1 bg-(--accent-dark) hover:bg-(--accent-primary) text-white rounded-lg flex items-center gap-1 text-xs font-semibold transition-colors"
									>
										<LogOut size={11} />
										<span>Leave</span>
									</button>
								</>
							)}

							<button
								onClick={() => setMobileTab("moves")}
								title="Move History"
								className={`p-1.5 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors ${
									mobileTab === "moves"
										? "bg-(--accent-primary) text-white"
										: "text-(--text-secondary) hover:text-(--text) hover:bg-(--bg-tertiary)"
								}`}
							>
								<ListOrdered size={14} />
								<span className="text-[11px] font-mono">{moveHistory.length}</span>
							</button>

							<button
								onClick={() => setMobileTab("chat")}
								title="Chat"
								className={`relative p-1.5 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors ${
									mobileTab === "chat"
										? "bg-(--accent-primary) text-white"
										: "text-(--text-secondary) hover:text-(--text) hover:bg-(--bg-tertiary)"
								}`}
							>
								<MessageCircle size={14} />
								{unreadCount > 0 && (
									<span className="absolute -top-1 -right-1 px-1 min-w-[14px] h-[14px] flex items-center justify-center text-[9px] font-bold bg-red-500 text-white rounded-full">
										{unreadCount}
									</span>
								)}
							</button>
						</div>
					</div>
				</div>

				{/* Right Desktop Sidebar */}
				<aside className="hidden lg:flex flex-col w-80 xl:w-96 rounded-2xl bg-(--bg-secondary) border border-(--border) overflow-hidden shadow-lg shrink-0">
					{/* Turn Status & TurnTimer Card */}
					<div className="shrink-0 p-3 border-b border-(--border) flex flex-col gap-2 bg-(--bg)/50">
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-2">
								<span className={`w-3 h-3 rounded-full ${currentTurn === "white" ? "bg-white border border-gray-400" : "bg-black border border-gray-600"}`} />
								<span className="text-xs font-bold uppercase tracking-wider text-(--text-primary)">
									{status === "active" ? (currentTurn === playerColor ? "Your Turn" : "Opponent's Turn") : "Game Over"}
								</span>
							</div>
							{inCheck && status === "active" && (
								<span className="text-xs font-bold text-red-500 animate-pulse flex items-center gap-1">
									<AlertTriangle size={12} />
									CHECK
								</span>
							)}
							{status === "finished" && (
								<span className="text-xs font-bold uppercase text-(--accent-primary)">
									{winner === "draw" ? "Draw" : winner === playerColor ? "Victory!" : "Defeat"}
								</span>
							)}
						</div>

						{status === "active" && (
							<div className="flex items-center justify-center py-0.5">
								<TurnTimer 
									secondsLeft={secondsLeft} 
									totalSeconds={timeControlSeconds}
									isCurrentTurn={playerColor === currentTurn}
								/>
							</div>
						)}
					</div>

					{/* Sidebar Tabs */}
					<div className="shrink-0 flex items-center border-b border-(--border) bg-(--bg-secondary)">
						<button
							onClick={() => setDesktopTab("moves")}
							className={`flex-1 py-2.5 text-xs font-semibold flex items-center justify-center gap-1.5 border-b-2 transition-colors ${
								desktopTab === "moves"
									? "border-(--accent-primary) text-(--accent-primary)"
									: "border-transparent text-(--text-secondary) hover:text-(--text)"
							}`}
						>
							<ListOrdered size={14} />
							<span>Moves ({moveHistory.length})</span>
						</button>
						<button
							onClick={() => setDesktopTab("chat")}
							className={`relative flex-1 py-2.5 text-xs font-semibold flex items-center justify-center gap-1.5 border-b-2 transition-colors ${
								desktopTab === "chat"
									? "border-(--accent-primary) text-(--accent-primary)"
									: "border-transparent text-(--text-secondary) hover:text-(--text)"
							}`}
						>
							<MessageCircle size={14} />
							<span>Chat</span>
							{unreadCount > 0 && (
								<span className="px-1.5 py-0.2 min-w-[16px] text-[10px] font-bold bg-red-500 text-white rounded-full">
									{unreadCount}
								</span>
							)}
						</button>
						<button
							onClick={() => setDesktopTab("settings")}
							className={`flex-1 py-2.5 text-xs font-semibold flex items-center justify-center gap-1.5 border-b-2 transition-colors ${
								desktopTab === "settings"
									? "border-(--accent-primary) text-(--accent-primary)"
									: "border-transparent text-(--text-secondary) hover:text-(--text)"
							}`}
						>
							<SettingsIcon size={14} />
							<span>Settings</span>
						</button>
					</div>

					{/* Tab Body */}
					<div className="flex-1 min-h-0 overflow-y-auto">
						{desktopTab === "moves" && renderMovesContent(false)}
						{desktopTab === "chat" && <ChatPanel inline={true} activeTab="chat" />}
						{desktopTab === "settings" && renderSettingsContent()}
					</div>

					{/* Footer Actions */}
					<div className="shrink-0 p-2.5 border-t border-(--border) flex items-center justify-between gap-2 bg-(--bg)">
						{status === "active" ? (
							<>
								<button
									onClick={handleResign}
									className="flex-1 py-2 px-3 rounded-xl bg-red-500/15 hover:bg-red-500 text-red-400 hover:text-white text-xs font-semibold transition-colors flex items-center justify-center gap-1.5"
								>
									<Flag size={12} />
									<span>Resign</span>
								</button>
								{drawOffer !== playerColor && (
									<button
										onClick={handleOfferDraw}
										className="flex-1 py-2 px-3 rounded-xl bg-blue-500/15 hover:bg-blue-500 text-blue-400 hover:text-white text-xs font-semibold transition-colors flex items-center justify-center gap-1.5"
									>
										<Handshake size={12} />
										<span>Draw</span>
									</button>
								)}
								{drawOffer && drawOffer !== playerColor && (
									<button
										onClick={handleAcceptDraw}
										className="flex-1 py-2 px-3 rounded-xl bg-green-500 hover:bg-green-600 text-white text-xs font-semibold transition-colors animate-pulse flex items-center justify-center gap-1.5"
									>
										<Handshake size={12} />
										<span>Accept</span>
									</button>
								)}
							</>
						) : status === "finished" ? (
							<>
								<button
									onClick={() => setShowResultModal(true)}
									className="flex-1 py-2 px-3 rounded-xl bg-purple-500/15 hover:bg-purple-500 text-purple-400 hover:text-white text-xs font-semibold transition-colors flex items-center justify-center gap-1.5"
									title="Share this game's board position as an image"
								>
									<Download size={12} />
									<span>Share</span>
								</button>
								<button
									onClick={handleLeaveGame}
									className="flex-1 py-2 px-3 rounded-xl bg-(--accent-dark) hover:bg-(--accent-primary) text-white text-xs font-semibold transition-colors flex items-center justify-center gap-1.5"
								>
									<LogOut size={12} />
									<span>Leave</span>
								</button>
							</>
						) : null}
					</div>
				</aside>
			</div>

			{/* ── Mobile Slide-up Drawer Modal ── */}
			{mobileTab && (
				<div
					className="fixed inset-0 z-50 lg:hidden flex flex-col justify-end bg-black/60 backdrop-blur-xs animate-fade-in"
					onClick={() => setMobileTab(null)}
				>
					<div
						className="w-full max-h-[80vh] bg-(--bg-secondary) border-t border-(--border) rounded-t-2xl flex flex-col overflow-hidden shadow-2xl"
						onClick={(e) => e.stopPropagation()}
					>
						<div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-(--border)">
							<div className="flex items-center gap-1.5 bg-(--bg) p-1 rounded-xl border border-(--border)">
								<button
									onClick={() => setMobileTab("moves")}
									className={`flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
										mobileTab === "moves"
											? "bg-(--accent-primary) text-white"
											: "text-(--text-secondary) hover:text-(--text)"
									}`}
								>
									<ListOrdered size={13} />
									<span>Moves</span>
								</button>
								<button
									onClick={() => setMobileTab("chat")}
									className={`relative flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
										mobileTab === "chat"
											? "bg-(--accent-primary) text-white"
											: "text-(--text-secondary) hover:text-(--text)"
									}`}
								>
									<MessageCircle size={13} />
									<span>Chat</span>
									{unreadCount > 0 && (
										<span className="ml-1 px-1 min-w-[14px] h-[14px] flex items-center justify-center text-[9px] font-bold bg-red-500 text-white rounded-full">
											{unreadCount}
										</span>
									)}
								</button>
								<button
									onClick={() => setMobileTab("settings")}
									className={`flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
										mobileTab === "settings"
											? "bg-(--accent-primary) text-white"
											: "text-(--text-secondary) hover:text-(--text)"
									}`}
								>
									<SettingsIcon size={13} />
									<span>Settings</span>
								</button>
							</div>

							<button
								onClick={() => setMobileTab(null)}
								className="p-1.5 rounded-lg text-(--text-tertiary) hover:text-(--text) hover:bg-(--bg-tertiary) transition-colors"
							>
								<X size={16} />
							</button>
						</div>

						<div className="flex-1 min-h-0 overflow-y-auto">
							{mobileTab === "moves" && renderMovesContent(true)}
							{mobileTab === "chat" && <ChatPanel inline={true} activeTab="chat" />}
							{mobileTab === "settings" && renderSettingsContent()}
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
