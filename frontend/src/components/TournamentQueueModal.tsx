import React, { useState, useEffect } from "react";
import type { MatchReadyEvent } from "../api/socket";
import { soundService } from "../services/soundService";

export const TournamentQueueModal: React.FC<{
	matchData: MatchReadyEvent;
	onEnterMatch: (gameCode: string) => void;
}> = ({ matchData, onEnterMatch }) => {
	const [secondsLeft, setSecondsLeft] = useState(60);

	useEffect(() => {
		soundService.playAlert();
	}, []);

	useEffect(() => {
		if (secondsLeft <= 0) {
			onEnterMatch(matchData.gameCode);
			return;
		}

		const timer = setInterval(() => {
			setSecondsLeft((prev) => prev - 1);
		}, 1000);

		return () => clearInterval(timer);
	}, [secondsLeft, matchData.gameCode, onEnterMatch]);

	return (
		<div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50">
			<div className="bg-slate-900 border border-amber-500 rounded-xl p-6 text-center max-w-md w-full shadow-[0_0_15px_rgba(245,158,11,0.5)]">
				<h2 className="text-2xl font-bold text-amber-400">⚔️ Match Ready!</h2>
				<p className="mt-2 text-slate-300">
					Your round {matchData.round} match is starting.
				</p>
				<div className="mt-4 mb-6 bg-slate-800 p-4 rounded-lg flex flex-col items-center border border-slate-700">
					<span className="text-sm text-slate-400 uppercase tracking-widest">
						Opponent
					</span>
					<span className="text-xl font-bold text-white mt-1">
						{matchData.opponentName}
					</span>
					<span className="text-amber-500 font-medium">
						({matchData.opponentRating})
					</span>
					<div className="mt-3 flex items-center gap-2">
						<span className="text-sm text-slate-400">Playing as:</span>
						<span
							className={`font-bold capitalize ${
								matchData.color === "white"
									? "text-white"
									: "text-slate-900 bg-slate-300 px-2 py-0.5 rounded"
							}`}
						>
							{matchData.color}
						</span>
					</div>
				</div>
				<button
					onClick={() => onEnterMatch(matchData.gameCode)}
					className="mt-2 w-full py-3 bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold rounded-lg transition-colors shadow-lg shadow-amber-500/20"
				>
					Join Board ({secondsLeft}s)
				</button>
			</div>
		</div>
	);
};
