import { Timer } from "lucide-react";

interface GameTimerProps {
	secondsLeft: number;
	totalSeconds: number;
	isCurrentTurn?: boolean;
}

function formatTime(s: number): string {
	const m = Math.floor(s / 60);
	const sec = Math.max(0, Math.ceil(s % 60));
	return `${m}:${sec.toString().padStart(2, "0")}`;
}

export default function GameTimer({ secondsLeft, totalSeconds, isCurrentTurn = false }: GameTimerProps) {
	const pct = totalSeconds > 0 ? (secondsLeft / totalSeconds) * 100 : 0;
	const urgent = secondsLeft <= 60;
	
	// Low time danger: <= 20s OR <= 10% of total time, AND it's the active player's turn
	const isLowTime = isCurrentTurn && (secondsLeft <= 20 || secondsLeft <= totalSeconds * 0.1);
	
	const display = formatTime(secondsLeft);

	return (
		<div className={`flex items-center gap-2 p-2 rounded-lg transition-all ${
			isLowTime 
				? "border-2 border-red-500 bg-red-950/40 animate-pulse" 
				: ""
		}`}>
			<Timer size={12} className={urgent ? "text-red-500" : "text-(--text-tertiary)"} />
			<span
				className={`font-mono font-bold text-sm tabular-nums ${urgent ? "text-red-500 animate-pulse" : "text-(--text-secondary)"}`}
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
