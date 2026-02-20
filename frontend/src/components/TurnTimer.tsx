import { Timer } from "lucide-react";

const TURN_TIME_LIMIT = 45;

interface TurnTimerProps {
	secondsLeft: number;
	isMyTurn: boolean;
}

export default function TurnTimer({ secondsLeft, isMyTurn }: TurnTimerProps) {
	const pct = (secondsLeft / TURN_TIME_LIMIT) * 100;
	const urgent = secondsLeft <= 10;
	const display = Math.ceil(secondsLeft);

	return (
		<div
			className={`flex items-center gap-2 ${isMyTurn ? "text-white" : "text-gray-400"}`}
		>
			<Timer size={12} className={urgent && isMyTurn ? "text-red-500" : ""} />
			<span
				className={`font-mono font-bold text-sm ${urgent && isMyTurn ? "text-red-500 animate-pulse" : ""}`}
			>
				{display}s
			</span>
			<div className="w-16 h-1.5 bg-gray-700 rounded-full overflow-hidden">
				<div
					className={`h-full rounded-full transition-all duration-1000 ${
						urgent ? "bg-red-500" : pct > 50 ? "bg-green-500" : "bg-yellow-400"
					}`}
					style={{ width: `${pct}%` }}
				/>
			</div>
		</div>
	);
}
