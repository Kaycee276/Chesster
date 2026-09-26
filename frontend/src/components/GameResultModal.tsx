import { useState } from "react";
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
