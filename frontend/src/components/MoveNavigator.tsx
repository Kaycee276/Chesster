import { useEffect, useState } from "react";
import {
	ChevronsLeft,
	ChevronLeft,
	ChevronRight,
	ChevronsRight,
	Play,
	Pause,
	Copy,
	FileText,
	Check,
} from "lucide-react";
import { useToastStore } from "../store/toastStore";

interface MoveNavigatorProps {
	/** -1 = starting position, otherwise the index of the last played move. */
	currentMoveIndex: number;
	totalMoves: number;
	isPlaying: boolean;
	onMoveChange: (index: number) => void;
	onTogglePlay: () => void;
	/** FEN string of the currently viewed board ply. */
	currentFen?: string | null;
	/** Full PGN text of the current game. */
	pgn?: string | null;
}

/**
 * Copies text to the system clipboard using the Async Clipboard API with a
 * textarea + execCommand('copy') fallback for non-secure contexts.
 */
async function copyTextToClipboard(text: string): Promise<boolean> {
	if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
		try {
			await navigator.clipboard.writeText(text);
			return true;
		} catch {
			// Fall through to legacy execCommand fallback
		}
	}

	if (typeof document === "undefined" || typeof document.execCommand !== "function") {
		return false;
	}

	const textarea = document.createElement("textarea");
	textarea.value = text;
	textarea.setAttribute("readonly", "");
	textarea.style.position = "fixed";
	textarea.style.top = "-9999px";
	textarea.style.left = "-9999px";
	document.body.appendChild(textarea);

	try {
		textarea.focus();
		textarea.select();
		return document.execCommand("copy");
	} catch {
		return false;
	} finally {
		document.body.removeChild(textarea);
	}
}

/**
 * Playback controls for the analysis board (#251): first/previous/
 * play-pause/next/last buttons plus a scrub slider, driven purely by
 * `currentMoveIndex` so the caller stays the single source of truth for
 * board position.
 */
export default function MoveNavigator({
	currentMoveIndex,
	totalMoves,
	isPlaying,
	onMoveChange,
	onTogglePlay,
	currentFen,
	pgn,
}: MoveNavigatorProps) {
	const atStart = currentMoveIndex <= -1;
	const atEnd = currentMoveIndex >= totalMoves - 1;
	const addToast = useToastStore((s) => s.addToast);
	const [copiedKind, setCopiedKind] = useState<"fen" | "pgn" | null>(null);

	const handleCopy = async (kind: "fen" | "pgn", value: string | null | undefined) => {
		if (!value) return;
		const label = kind === "fen" ? "FEN" : "PGN";
		const ok = await copyTextToClipboard(value);
		if (ok) {
			addToast(`${label} copied to clipboard!`, "success");
			setCopiedKind(kind);
			setTimeout(() => {
				setCopiedKind((prev) => (prev === kind ? null : prev));
			}, 1500);
		} else {
			addToast(`Failed to copy ${label} to clipboard`, "error");
		}
	};

	// Auto-advance one ply at a time while playing; pausing again once the
	// mainline runs out, via the same callback the pause button uses.
	useEffect(() => {
		if (!isPlaying || totalMoves === 0) return;
		if (currentMoveIndex >= totalMoves - 1) {
			onTogglePlay();
			return;
		}
		const t = setTimeout(() => {
			onMoveChange(Math.min(totalMoves - 1, currentMoveIndex + 1));
		}, 800);
		return () => clearTimeout(t);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [isPlaying, currentMoveIndex, totalMoves]);

	// Keyboard shortcut navigation (#555): ArrowLeft, ArrowRight, Home/ArrowUp, End/ArrowDown
	// Suppressed when user is typing in an input, textarea, or contentEditable element.
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			const target = e.target as HTMLElement | null;
			if (
				target &&
				(target.tagName === "INPUT" ||
					target.tagName === "TEXTAREA" ||
					Boolean(target.isContentEditable) ||
					target.getAttribute?.("contenteditable") === "true" ||
					(typeof target.closest === "function" && Boolean(target.closest('[contenteditable="true"]'))))
			) {
				return;
			}

			switch (e.key) {
				case "ArrowLeft":
					e.preventDefault();
					if (currentMoveIndex > -1) {
						onMoveChange(currentMoveIndex - 1);
					}
					break;
				case "ArrowRight":
					e.preventDefault();
					if (currentMoveIndex < totalMoves - 1) {
						onMoveChange(currentMoveIndex + 1);
					}
					break;
				case "Home":
				case "ArrowUp":
					e.preventDefault();
					onMoveChange(-1);
					break;
				case "End":
				case "ArrowDown":
					e.preventDefault();
					onMoveChange(totalMoves - 1);
					break;
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [currentMoveIndex, totalMoves, onMoveChange]);

	return (
		<div className="flex flex-col gap-2 w-full">
			<div className="flex items-center justify-center gap-2 py-2">
				<button
					onClick={() => onMoveChange(-1)}
					disabled={atStart}
					title="First move (Home / Up Arrow)"
					aria-label="First move (Home / Up Arrow)"
					className="p-2 rounded-lg bg-(--bg-secondary) border border-(--border) hover:border-(--accent-primary)/60 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
				>
					<ChevronsLeft size={16} />
				</button>
				<button
					onClick={() => onMoveChange(currentMoveIndex - 1)}
					disabled={atStart}
					title="Previous move (Left Arrow)"
					aria-label="Previous move (Left Arrow)"
					className="p-2 rounded-lg bg-(--bg-secondary) border border-(--border) hover:border-(--accent-primary)/60 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
				>
					<ChevronLeft size={16} />
				</button>
				<button
					onClick={onTogglePlay}
					disabled={totalMoves === 0}
					title={isPlaying ? "Pause" : "Play"}
					aria-label={isPlaying ? "Pause" : "Play"}
					className="p-2.5 rounded-lg bg-(--accent-dark) hover:bg-(--accent-primary) disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-white"
				>
					{isPlaying ? <Pause size={16} /> : <Play size={16} />}
				</button>
				<button
					onClick={() => onMoveChange(currentMoveIndex + 1)}
					disabled={atEnd}
					title="Next move (Right Arrow)"
					aria-label="Next move (Right Arrow)"
					className="p-2 rounded-lg bg-(--bg-secondary) border border-(--border) hover:border-(--accent-primary)/60 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
				>
					<ChevronRight size={16} />
				</button>
				<button
					onClick={() => onMoveChange(totalMoves - 1)}
					disabled={atEnd}
					title="Last move (End / Down Arrow)"
					aria-label="Last move (End / Down Arrow)"
					className="p-2 rounded-lg bg-(--bg-secondary) border border-(--border) hover:border-(--accent-primary)/60 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
				>
					<ChevronsRight size={16} />
				</button>
			</div>

			{totalMoves > 0 && (
				<div className="flex items-center gap-2 px-1">
					<span className="text-[10px] font-mono text-(--text-tertiary) w-6 text-right">
						{currentMoveIndex + 1}
					</span>
					<input
						type="range"
						min={-1}
						max={totalMoves - 1}
						value={currentMoveIndex}
						onChange={(e) => onMoveChange(Number(e.target.value))}
						className="flex-1 accent-(--accent-primary)"
						aria-label="Move scrubber"
					/>
					<span className="text-[10px] font-mono text-(--text-tertiary) w-6">
						{totalMoves}
					</span>
				</div>
			)}

			<div className="flex items-center justify-center gap-2">
				<button
					type="button"
					onClick={() => void handleCopy("fen", currentFen)}
					disabled={!currentFen}
					title="Copy FEN to clipboard"
					aria-label="Copy FEN to clipboard"
					className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-(--bg-secondary) border border-(--border) hover:border-(--accent-primary)/60 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
				>
					{copiedKind === "fen" ? (
						<Check size={14} aria-hidden="true" />
					) : (
						<Copy size={14} aria-hidden="true" />
					)}
					<span>FEN</span>
				</button>
				<button
					type="button"
					onClick={() => void handleCopy("pgn", pgn)}
					disabled={!pgn}
					title="Copy PGN to clipboard"
					aria-label="Copy PGN to clipboard"
					className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-(--bg-secondary) border border-(--border) hover:border-(--accent-primary)/60 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
				>
					{copiedKind === "pgn" ? (
						<Check size={14} aria-hidden="true" />
					) : (
						<FileText size={14} aria-hidden="true" />
					)}
					<span>PGN</span>
				</button>
			</div>
		</div>
	);
}
