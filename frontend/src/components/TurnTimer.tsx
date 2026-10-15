import { useEffect, useRef } from "react";
import { Timer } from "lucide-react";
import { soundService } from "../services/soundService";

interface GameTimerProps {
	secondsLeft: number;
	totalSeconds: number;
	isCurrentTurn?: boolean;
}

/** Clock is considered "low" once it drops to this many seconds or fewer. */
const LOW_TIME_THRESHOLD = 10;

function formatTime(s: number): string {
	const clamped = Math.max(0, s);
	const m = Math.floor(clamped / 60);
	const sec = Math.max(0, Math.ceil(clamped % 60));
	return `${m}:${sec.toString().padStart(2, "0")}`;
}

export default function GameTimer({ secondsLeft, totalSeconds, isCurrentTurn = false }: GameTimerProps) {
	const pct = totalSeconds > 0 ? (secondsLeft / totalSeconds) * 100 : 0;
	const urgent = secondsLeft <= 60;
	
	// Low time danger: <= 20s OR <= 10% of total time, AND it's the active player's turn
	const isLowTime = isCurrentTurn && (secondsLeft <= 20 || secondsLeft <= totalSeconds * 0.1);
	// Critical scramble: under 10s on your turn — pulse accelerates (#474).
	const isCritical = isCurrentTurn && secondsLeft <= 10 && secondsLeft > 0;
	
	const lowTime = secondsLeft <= LOW_TIME_THRESHOLD;
	const display = formatTime(secondsLeft);

	// Play a warning tick once when the clock crosses into the low-time zone.
	const wasLowRef = useRef(false);
	useEffect(() => {
		if (lowTime && secondsLeft > 0 && !wasLowRef.current) {
			soundService.lowTime();
		}
		wasLowRef.current = lowTime && secondsLeft > 0;
	}, [lowTime, secondsLeft]);

	const ariaLabel = isLowTime
		? `Low time warning: ${Math.ceil(Math.max(0, secondsLeft))} seconds remaining`
		: `Time remaining: ${display}`;

	return (
		<div
			role="timer"
			aria-live="polite"
			aria-atomic="true"
			aria-label={ariaLabel}
			className={`flex items-center gap-2 p-2 rounded-lg transition-all ${
				isLowTime
					? "border-2 border-red-500 ring-2 ring-red-500 bg-red-950/40 animate-pulse turn-timer-emergency text-red-400 font-bold"
					: ""
			} ${isCritical ? "turn-timer-critical" : ""}`}
		>
			<Timer size={12} className={urgent ? "text-red-500" : "text-(--text-tertiary)"} />
			<span
				className={`font-mono font-bold text-sm tabular-nums ${urgent ? "text-red-400 animate-pulse" : "text-(--text-secondary)"}`}
			>
				{display}
			</span>
			<div className="w-20 h-1.5 bg-gray-700 rounded-full overflow-hidden">
				<div
					className={`h-full rounded-full transition-all duration-1000 ${
						urgent ? "bg-red-500" : pct > 50 ? "bg-green-500" : "bg-yellow-400"
					}`}
					style={{ width: `${Math.max(0, pct)}%` }}
				/>
			</div>
		</div>
	);
}
