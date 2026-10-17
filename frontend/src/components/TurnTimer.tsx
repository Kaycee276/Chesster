import { useEffect, useRef, useState } from "react";
import { Timer } from "lucide-react";
import { soundService } from "../services/soundService";
import { formatTime } from "../utils/timeControl";

interface GameTimerProps {
	secondsLeft: number;
	totalSeconds: number;
	isCurrentTurn?: boolean;
	isClockRunning?: boolean;
}

/** Clock is considered "low" once it drops to this many seconds or fewer. */
const LOW_TIME_THRESHOLD = 10;

export default function GameTimer({ secondsLeft, totalSeconds, isCurrentTurn = false, isClockRunning = true }: GameTimerProps) {
	const [clock, setClock] = useState<{ deadline: number; now: number } | null>(null);

	useEffect(() => {
		if (secondsLeft >= 10 || !isClockRunning) return;
		let deadline: number | null = null;
		const interval = window.setInterval(() => {
			const now = Date.now();
			deadline ??= now + Math.max(0, secondsLeft) * 1000;
			setClock({ deadline, now });
		}, 100);
		return () => window.clearInterval(interval);
	}, [isClockRunning, secondsLeft]);

	const displayMs = secondsLeft < 10 && isClockRunning
		? Math.max(0, clock ? clock.deadline - clock.now : secondsLeft * 1000)
		: Math.max(0, secondsLeft * 1000);
	const pct = totalSeconds > 0 ? (displayMs / (totalSeconds * 1000)) * 100 : 0;
	const urgent = displayMs <= 60_000;
	
	// Low time danger: <= 20s OR <= 10% of total time, AND it's the active player's turn
	const isLowTime = isCurrentTurn && (displayMs <= 20_000 || displayMs <= totalSeconds * 100);
	// Critical scramble: under 10s on your turn — pulse accelerates (#474).
	const isCritical = isCurrentTurn && displayMs <= 10_000 && displayMs > 0;
	
	const lowTime = displayMs <= LOW_TIME_THRESHOLD * 1000;
	const isScramble = displayMs < 10_000;
	const display = formatTime(displayMs);

	// Play a warning tick once when the clock crosses into the low-time zone.
	const wasLowRef = useRef(false);
	useEffect(() => {
		if (isCurrentTurn && lowTime && secondsLeft > 0 && !wasLowRef.current) {
			soundService.lowTime();
		}
		wasLowRef.current = isCurrentTurn && lowTime && secondsLeft > 0;
	}, [isCurrentTurn, lowTime, secondsLeft]);

	const ariaLabel = isLowTime
		? `Low time warning: ${Math.ceil(displayMs / 1000)} seconds remaining`
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
				className={`font-mono font-bold text-sm tabular-nums ${isScramble ? "text-red-400 animate-pulse" : urgent ? "text-red-400 animate-pulse" : "text-(--text-secondary)"}`}
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
