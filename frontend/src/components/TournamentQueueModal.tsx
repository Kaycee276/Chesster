import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { MatchReadyEvent } from "../api/socket";
import { soundService } from "../services/soundService";
import { TournamentBracketTree, type TreeMatch, type TreeRound } from "./TournamentBracketTree";

export interface TournamentQueueModalProps {
	matchData?: MatchReadyEvent | null;
	onEnterMatch?: (gameCode: string) => void;
	status?: "waiting" | "in_progress" | string;
	bracketMatches?: TreeMatch[];
	bracketRounds?: TreeRound[];
	onSpectateMatch?: (gameCode: string) => void;
	onClose?: () => void;
}

export const TournamentQueueModal: React.FC<TournamentQueueModalProps> = ({
	matchData,
	onEnterMatch,
	status,
	bracketMatches,
	bracketRounds,
	onSpectateMatch,
	onClose,
}) => {
	const { t } = useTranslation();
	const [secondsLeft, setSecondsLeft] = useState(60);

	useEffect(() => {
		if (matchData) {
			soundService.playAlert();
		}
	}, [matchData]);

	useEffect(() => {
		if (!matchData || !onEnterMatch) return;
		if (secondsLeft <= 0) {
			onEnterMatch(matchData.gameCode);
			return;
		}

		const timer = setInterval(() => {
			setSecondsLeft((prev) => prev - 1);
		}, 1000);

		return () => clearInterval(timer);
	}, [secondsLeft, matchData, onEnterMatch]);

	if (status === "in_progress") {
		return (
			<div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
				<div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-5xl w-full max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
					<div className="flex items-center justify-between p-4 border-b border-slate-800">
						<div>
							<h2 className="text-xl font-bold text-amber-400">
								{t("tournament.bracketProgress", "Tournament in Progress")}
							</h2>
							<p className="text-xs text-slate-400 mt-0.5">
								{t("tournament.liveBracketSubtitle", "Track matches and live progression")}
							</p>
						</div>
						{onClose && (
							<button
								onClick={onClose}
								className="text-slate-400 hover:text-white p-1 rounded-lg text-sm"
							>
								✕
							</button>
						)}
					</div>
					<div className="flex-1 overflow-auto p-2">
						<TournamentBracketTree
							matches={bracketMatches}
							rounds={bracketRounds}
							onMatchClick={onSpectateMatch}
						/>
					</div>
				</div>
			</div>
		);
	}

	if (!matchData) return null;

	return (
		<div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50">
			<div className="bg-slate-900 border border-amber-500 rounded-xl p-6 text-center max-w-md w-full shadow-[0_0_15px_rgba(245,158,11,0.5)]">
				<h2 className="text-2xl font-bold text-amber-400">
					{t("tournament.matchReadyTitle", "⚔️ Match Ready!")}
				</h2>
				<p className="mt-2 text-slate-300">
					{t("tournament.matchStarting", {
						round: matchData.round,
						defaultValue: `Your round ${matchData.round} match is starting.`,
					})}
				</p>
				<div className="mt-4 mb-6 bg-slate-800 p-4 rounded-lg flex flex-col items-center border border-slate-700">
					<span className="text-sm text-slate-400 uppercase tracking-widest">
						{t("tournament.opponent", "Opponent")}
					</span>
					<span className="text-xl font-bold text-white mt-1">
						{matchData.opponentName}
					</span>
					<span className="text-amber-500 font-medium">
						({matchData.opponentRating})
					</span>
					<div className="mt-3 flex items-center gap-2">
						<span className="text-sm text-slate-400">
							{t("tournament.playingAs", "Playing as:")}
						</span>
						<span
							className={`font-bold capitalize ${
								matchData.color === "white"
									? "text-white"
									: "text-slate-900 bg-slate-300 px-2 py-0.5 rounded"
							}`}
						>
							{t(`common.${matchData.color}`, matchData.color)}
						</span>
					</div>
				</div>
				<button
					onClick={() => onEnterMatch?.(matchData.gameCode)}
					className="mt-2 w-full py-3 bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold rounded-lg transition-colors shadow-lg shadow-amber-500/20"
				>
					{t("tournament.joinBoard", {
						seconds: secondsLeft,
						defaultValue: `Join Board (${secondsLeft}s)`,
					})}
				</button>
			</div>
		</div>
	);
};
