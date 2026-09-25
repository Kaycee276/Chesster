import { useState } from "react";
import { Download, Copy, Check, Loader2, AlertTriangle, X } from "lucide-react";
import { generateBoardSocialCard } from "../utils/boardImageGenerator";
import { boardToFen } from "../utils/chessUtils";
import { useThemeStore } from "../store/themeStore";
import { useToastStore } from "../store/toastStore";

interface GameResultModalProps {
	isOpen: boolean;
	onClose: () => void;
	board: string[][];
	currentTurn: "white" | "black";
	winner?: string | null;
	endReason?: string | null;
	whiteUsername: string;
	whiteRating: number | string;
	blackUsername: string;
	blackRating: number | string;
}

/**
 * Modal for displaying game results and allowing players to share/download board images.
 */
export default function GameResultModal({
	isOpen,
	onClose,
	board,
	currentTurn,
	winner,
	endReason,
	whiteUsername,
	whiteRating,
	blackUsername,
	blackRating,
}: GameResultModalProps) {
	const [isGenerating, setIsGenerating] = useState(false);
	const [hasError, setHasError] = useState(false);
	const [copied, setCopied] = useState(false);

	const boardTheme = useThemeStore((s) => s.boardTheme);
	const { addToast } = useToastStore();

	if (!isOpen) return null;

	/**
	 * Generate result text based on winner and reason
	 */
	const getResultText = (): string => {
		if (winner === "draw") {
			return endReason ? `Draw - ${endReason}` : "Draw";
		}
		const winnerColor = winner === "white" ? "White" : "Black";
		if (endReason) {
			return `${winnerColor} wins - ${endReason}`;
		}
		return `${winnerColor} wins`;
	};

	/**
	 * Generate and download the board image
	 */
	const handleDownload = async () => {
		try {
			setIsGenerating(true);
			setHasError(false);

			// Generate FEN from current board state
			const fen = boardToFen(board, currentTurn);

			// Generate the social card image
			const blob = await generateBoardSocialCard(
				fen,
				whiteUsername,
				whiteRating,
				blackUsername,
				blackRating,
				getResultText(),
				boardTheme,
			);

			// Create download link and trigger download
			const url = URL.createObjectURL(blob);
			const link = document.createElement("a");
			link.href = url;
			link.download = `chesster-game-${Date.now()}.png`;
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			URL.revokeObjectURL(url);

			addToast("Board image downloaded!", "success");
		} catch (error) {
			console.error("Failed to generate board image:", error);
			setHasError(true);
			addToast("Failed to generate board image", "error");
		} finally {
			setIsGenerating(false);
		}
	};

	/**
	 * Generate and copy the board image to clipboard
	 */
	const handleCopyToClipboard = async () => {
		try {
			setIsGenerating(true);
			setHasError(false);

			// Check if the Clipboard API supports image types
			if (!navigator.clipboard.write) {
				throw new Error("Clipboard image copy not supported in your browser");
			}

			// Generate FEN from current board state
			const fen = boardToFen(board, currentTurn);

			// Generate the social card image
			const blob = await generateBoardSocialCard(
				fen,
				whiteUsername,
				whiteRating,
				blackUsername,
				blackRating,
				getResultText(),
				boardTheme,
			);

			// Copy to clipboard
			const item = new ClipboardItem({ "image/png": blob });
			await navigator.clipboard.write([item]);

			setCopied(true);
			addToast("Board image copied to clipboard!", "success");

			// Reset copied state after 2 seconds
			setTimeout(() => setCopied(false), 2000);
		} catch (error) {
			console.error("Failed to copy board image:", error);

			// If clipboard write fails, fall back to download
			if (error instanceof Error && error.message.includes("not supported")) {
				addToast("Clipboard copy not supported — download the image instead", "info");
			} else {
				setHasError(true);
				addToast("Failed to copy board image to clipboard", "error");
			}
		} finally {
			setIsGenerating(false);
		}
	};

	const resultText = getResultText();
	const resultTitle =
		winner === "draw"
			? "Game Drawn"
			: winner === "white"
				? "White Wins"
				: "Black Wins";

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
			<div className="relative w-full max-w-lg mx-4 bg-(--bg-secondary) border border-(--border) rounded-2xl p-6 flex flex-col gap-5 shadow-2xl">
				{/* Close button */}
				<button
					onClick={onClose}
					className="absolute top-4 right-4 text-(--text-tertiary) hover:text-(--text) transition-colors"
					aria-label="Close modal"
import { Copy, Check, ExternalLink, RefreshCw, Share2, Trophy, Handshake, Frown, X } from "lucide-react";
import type { GameOutcome } from "../utils/gameResult";
import { buildResultTitle, buildShareText, buildTwitterShareUrl, getEndReasonLabel } from "../utils/gameResult";

const EXPLORER_BASE = "https://stellar.expert/explorer/testnet/tx/";

interface GameResultModalProps {
	outcome: GameOutcome;
	endReason?: string | null;
	gameCode?: string | null;
	pgn: string;
	txHash?: string | null;
	eloDelta?: number | null;
	onRematch: () => void;
	onClose: () => void;
}

function OutcomeIcon({ outcome }: { outcome: GameOutcome }) {
	if (outcome === "win") return <Trophy size={40} className="text-yellow-400" />;
	if (outcome === "draw") return <Handshake size={40} className="text-(--text-secondary)" />;
	return <Frown size={40} className="text-(--text-tertiary)" />;
}

export default function GameResultModal({
	outcome,
	endReason,
	gameCode,
	pgn,
	txHash,
	eloDelta,
	onRematch,
	onClose,
}: GameResultModalProps) {
	const [copied, setCopied] = useState(false);
	const [rematchSent, setRematchSent] = useState(false);

	const handleCopyPgn = async () => {
		try {
			await navigator.clipboard.writeText(pgn);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			// Clipboard access denied — nothing further we can do here.
		}
	};

	const handleRematch = () => {
		onRematch();
		setRematchSent(true);
	};

	const shareUrl = buildTwitterShareUrl(
		buildShareText(outcome, gameCode),
		gameCode ? `${window.location.origin}/game/${gameCode}` : undefined,
	);

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
			onClick={onClose}
		>
			<div
				className="relative w-full max-w-sm bg-(--bg-secondary) border border-(--border) rounded-2xl p-6 flex flex-col gap-5 shadow-2xl text-center"
				onClick={(e) => e.stopPropagation()}
			>
				<button
					onClick={onClose}
					className="absolute top-4 right-4 text-(--text-tertiary) hover:text-(--text) transition-colors"
				>
					<X size={16} />
				</button>

				{/* Title and result */}
				<div className="flex flex-col gap-1">
					<h2 className="text-2xl font-bold">{resultTitle}</h2>
					<p className="text-sm text-(--text-secondary)">{resultText}</p>
				</div>

				{/* Player info */}
				<div className="grid grid-cols-2 gap-4 bg-(--bg) rounded-xl p-4">
					<div className="flex flex-col gap-1">
						<p className="text-xs font-semibold uppercase tracking-widest text-(--text-tertiary)">
							White
						</p>
						<p className="font-semibold text-white">{whiteUsername}</p>
						<p className="text-xs text-(--text-secondary)">
							Rating: {whiteRating}
						</p>
					</div>
					<div className="flex flex-col gap-1">
						<p className="text-xs font-semibold uppercase tracking-widest text-(--text-tertiary)">
							Black
						</p>
						<p className="font-semibold text-white">{blackUsername}</p>
						<p className="text-xs text-(--text-secondary)">
							Rating: {blackRating}
						</p>
					</div>
				</div>

				{/* Error state */}
				{hasError && (
					<div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-lg p-3">
						<AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
						<p className="text-xs text-red-400">
							Failed to generate the board image. Please try again.
						</p>
					</div>
				)}

				{/* Action buttons */}
				<div className="flex flex-col gap-2">
					{/* Download button */}
					<button
						onClick={handleDownload}
						disabled={isGenerating}
						className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-(--accent-primary) hover:bg-(--accent-dark) disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-semibold transition-colors"
					>
						{isGenerating ? (
							<>
								<Loader2 size={16} className="animate-spin" />
								Generating…
							</>
						) : (
							<>
								<Download size={16} />
								Download Board Image
							</>
						)}
					</button>

					{/* Copy to clipboard button */}
					<button
						onClick={handleCopyToClipboard}
						disabled={isGenerating}
						className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-(--bg) border border-(--border) hover:border-(--accent-primary)/50 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-semibold transition-colors"
					>
						{isGenerating ? (
							<>
								<Loader2 size={16} className="animate-spin" />
								Generating…
							</>
						) : copied ? (
							<>
								<Check size={16} className="text-green-400" />
								Copied!
							</>
						) : (
							<>
								<Copy size={16} />
								Copy to Clipboard
							</>
						)}
					</button>
				</div>

				{/* Info text */}
				<p className="text-xs text-(--text-tertiary) text-center leading-relaxed">
					Share your board position on Twitter, Discord, or Telegram. The image
					includes the final position, player ratings, and game outcome.
				</p>
				<div className="flex flex-col items-center gap-2">
					<OutcomeIcon outcome={outcome} />
					<h2 className="text-3xl font-extrabold">{buildResultTitle(outcome)}</h2>
					<p className="text-sm text-(--text-secondary)">{getEndReasonLabel(endReason)}</p>
				</div>

				{typeof eloDelta === "number" && (
					<div
						className={`text-lg font-bold ${eloDelta > 0 ? "text-emerald-400" : eloDelta < 0 ? "text-red-400" : "text-(--text-secondary)"}`}
					>
						{eloDelta > 0 ? `+${eloDelta}` : eloDelta} Elo
					</div>
				)}

				{txHash && (
					<a
						href={`${EXPLORER_BASE}${txHash}`}
						target="_blank"
						rel="noopener noreferrer"
						className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 hover:bg-amber-500/25 transition-colors text-sm font-semibold"
					>
						<ExternalLink size={14} />
						View Escrow Payout
					</a>
				)}

				<div className="flex flex-col gap-2">
					<button
						onClick={handleCopyPgn}
						className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-(--bg-tertiary) hover:bg-(--border) text-sm font-semibold transition-colors"
					>
						{copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
						{copied ? "Copied!" : "Copy PGN"}
					</button>

					<button
						onClick={handleRematch}
						disabled={rematchSent}
						className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-(--accent-dark) hover:bg-(--accent-primary) disabled:opacity-60 disabled:cursor-not-allowed text-sm font-semibold transition-colors"
					>
						<RefreshCw size={14} />
						{rematchSent ? "Rematch Requested" : "Request Rematch"}
					</button>

					<a
						href={shareUrl}
						target="_blank"
						rel="noopener noreferrer"
						className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-sky-500/15 border border-sky-500/30 text-sky-400 hover:bg-sky-500/25 transition-colors text-sm font-semibold"
					>
						<Share2 size={14} />
						Share on X
					</a>
				</div>
			</div>
		</div>
	);
}
