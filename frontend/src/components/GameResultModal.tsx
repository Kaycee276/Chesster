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
			</div>
		</div>
	);
}
