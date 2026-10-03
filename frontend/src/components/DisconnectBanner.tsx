import { useEffect } from "react";
import { Wifi, WifiOff } from "lucide-react";

/**
 * DisconnectBanner (#317)
 *
 * Floating banner shown above the chessboard while the opponent's socket is
 * disconnected. The server starts a 60-second grace timer on disconnect and
 * auto-forfeits the match if the opponent does not return in time; this
 * component mirrors that countdown client-side so the remaining player can
 * see exactly how long the reclaim window is.
 *
 * Lifecycle:
 *  - `opponentName` + `graceSeconds` (60 → 0) render the countdown bar.
 *  - At 0 the countdown is replaced by a "Claim Win" button; the actual
 *    forfeit is performed by the server, this button only surfaces it.
 *  - `reconnected` renders a transient green badge and then calls
 *    `onDismiss` so the banner leaves the DOM cleanly.
 *
 * The matching countdown hook lives in `../hooks/useGraceCountdown`.
 */

interface DisconnectBannerProps {
	/** Display name of the player who dropped. */
	opponentName: string;
	/** Seconds left in the server's reconnect grace period (60 → 0). */
	graceSeconds: number;
	/** Total grace period the countdown started from; drives the bar width. */
	totalSeconds: number;
	/** True once the opponent's reconnect event arrived. */
	reconnected: boolean;
	/** Invoked when the grace period expires and the player claims the win. */
	onClaimWin: () => void;
	/** Invoked after the "Reconnected!" badge has been shown. */
	onDismiss: () => void;
}

const RECONNECTED_BADGE_MS = 2500;

export default function DisconnectBanner({
	opponentName,
	graceSeconds,
	totalSeconds,
	reconnected,
	onClaimWin,
	onDismiss,
}: DisconnectBannerProps) {
	// Auto-dismiss shortly after the green badge appears so play resumes
	// without the banner lingering over the board.
	useEffect(() => {
		if (!reconnected) return;
		const id = setTimeout(onDismiss, RECONNECTED_BADGE_MS);
		return () => clearTimeout(id);
	}, [reconnected, onDismiss]);

	if (reconnected) {
		return (
			<div
				role="status"
				className="flex items-center justify-center gap-2 rounded-lg border border-green-500/60 bg-green-500/15 px-3 py-2 text-sm font-semibold text-green-400"
			>
				<Wifi size={14} aria-hidden="true" />
				{opponentName} reconnected. Resuming play…
			</div>
		);
	}

	const fraction =
		totalSeconds > 0 ? Math.max(0, Math.min(1, graceSeconds / totalSeconds)) : 0;
	const expired = graceSeconds <= 0;

	return (
		<div
			role="alert"
			className="rounded-lg border border-amber-500/60 bg-amber-950/80 px-3 py-2 text-amber-200"
		>
			<div className="flex items-center justify-between gap-3">
				<span className="flex min-w-0 items-center gap-2 text-sm">
					<WifiOff
						size={14}
						className="shrink-0"
						aria-hidden="true"
					/>
					<span className="truncate">
						⚠️ {opponentName} disconnected.{" "}
						{expired
							? "Grace period expired."
							: `Reconnecting (${graceSeconds}s remaining)…`}
					</span>
				</span>
				{expired && (
					<button
						type="button"
						onClick={onClaimWin}
						className="shrink-0 rounded-md bg-amber-500 px-3 py-1 text-xs font-bold text-black transition-colors hover:bg-amber-400"
					>
						Claim Win
					</button>
				)}
			</div>
			{/* Live countdown bar; mirrors the server-side grace timer. */}
			<div
				className="mt-1.5 h-1 overflow-hidden rounded-full bg-amber-900/60"
				aria-hidden="true"
			>
				<div
					className="h-full rounded-full bg-amber-500 transition-[width] duration-1000 ease-linear"
					style={{ width: `${fraction * 100}%` }}
				/>
			</div>
			{/* Announce the remaining seconds to screen readers every tick. */}
			<p className="sr-only" aria-live="polite">
				{expired
					? `Grace period expired. You may claim the win.`
					: `${graceSeconds} seconds remaining before you can claim the win.`}
			</p>
		</div>
	);
}
