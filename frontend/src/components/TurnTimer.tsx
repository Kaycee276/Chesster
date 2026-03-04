import { Timer } from "lucide-react";

interface TurnTimerProps {
	secondsLeft: number;
	totalSeconds: number;
	isMyTurn: boolean;
}

function formatTime(s: number): string {
	const m = Math.floor(s / 60);
	const sec = Math.max(0, Math.ceil(s % 60));
	return `${m}:${sec.toString().padStart(2, "0")}`;
}

export default function TurnTimer({ secondsLeft, totalSeconds, isMyTurn }: TurnTimerProps) {
	const pct = totalSeconds > 0 ? (secondsLeft / totalSeconds) * 100 : 0;
	const urgent = secondsLeft <= 30;
	const display = formatTime(secondsLeft);

	return (
		<div
			className={`flex items-center gap-2 ${isMyTurn ? "text-white" : "text-gray-400"}`}
		>
			<Timer size={12} className={urgent && isMyTurn ? "text-red-500" : ""} />
			<span
				className={`font-mono font-bold text-sm tabular-nums ${urgent && isMyTurn ? "text-red-500 animate-pulse" : ""}`}
			>
				{display}
			</span>
			<div className="w-16 h-1.5 bg-gray-700 rounded-full overflow-hidden">
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
