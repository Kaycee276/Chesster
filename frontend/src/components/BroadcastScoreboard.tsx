import React, { useEffect, useState } from "react";
import GameTimer from "./TurnTimer";

export interface BroadcastScoreboardProps {
	whitePlayer?: string;
	blackPlayer?: string;
	whiteAddress?: string | null;
	blackAddress?: string | null;
	whiteRating?: number | null;
	blackRating?: number | null;
	currentTurn?: "white" | "black";
	whiteTimeLeft?: number;
	blackTimeLeft?: number;
	totalSeconds?: number;
	showClocks?: boolean;
	wagerAmount?: string | number | null;
	whiteMaterialAdvantage?: number;
	blackMaterialAdvantage?: number;
	isWhiteDisconnected?: boolean;
	isBlackDisconnected?: boolean;
	isGameOver?: boolean;
	gameOverReason?: string | null;
}

export default function BroadcastScoreboard({
	whitePlayer = "White",
	blackPlayer = "Black",
	whiteAddress,
	blackAddress,
	whiteRating,
	blackRating,
	currentTurn = "white",
	whiteTimeLeft = 300,
	blackTimeLeft = 300,
	totalSeconds = 300,
	showClocks = true,
	wagerAmount,
	whiteMaterialAdvantage = 0,
	blackMaterialAdvantage = 0,
	isWhiteDisconnected = false,
	isBlackDisconnected = false,
	isGameOver = false,
	gameOverReason,
}: BroadcastScoreboardProps) {
	const [whiteClock, setWhiteClock] = useState(whiteTimeLeft);
	const [prevWhiteTimeLeft, setPrevWhiteTimeLeft] = useState(whiteTimeLeft);
	const [blackClock, setBlackClock] = useState(blackTimeLeft);
	const [prevBlackTimeLeft, setPrevBlackTimeLeft] = useState(blackTimeLeft);

	if (whiteTimeLeft !== prevWhiteTimeLeft) {
		setPrevWhiteTimeLeft(whiteTimeLeft);
		setWhiteClock(whiteTimeLeft);
	}

	if (blackTimeLeft !== prevBlackTimeLeft) {
		setPrevBlackTimeLeft(blackTimeLeft);
		setBlackClock(blackTimeLeft);
	}

	useEffect(() => {
		if (isGameOver) return;
		const interval = setInterval(() => {
			if (currentTurn === "white") {
				setWhiteClock((prev) => Math.max(0, prev - 1));
			} else {
				setBlackClock((prev) => Math.max(0, prev - 1));
			}
		}, 1000);
		return () => clearInterval(interval);
	}, [currentTurn, isGameOver]);

	const renderPlayerCard = (
		color: "white" | "black",
		name: string,
		address?: string | null,
		rating?: number | null,
		clockSeconds: number = 300,
		advantage: number = 0,
		isDisconnected: boolean = false,
	) => {
		const isTurn = currentTurn === color && !isGameOver;
		const isLowTime = clockSeconds < 10 && isTurn;

		return (
			<div
				data-testid={`player-card-${color}`}
				className={`flex min-w-0 flex-1 items-center justify-between gap-3 rounded-xl border px-4 py-3 backdrop-blur-md transition-all ${
					isTurn
						? "border-emerald-500 bg-slate-950/90 shadow-[0_0_24px_rgba(16,185,129,.25)]"
						: "border-white/15 bg-slate-950/75"
				}`}
			>
				<div className="min-w-0">
					<div className="flex items-center gap-2">
						<span className="truncate font-semibold text-white">{name}</span>
						{address && (
							<span
								data-testid={`wallet-badge-${color}`}
								className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono text-cyan-300"
							>
								{address.length > 8 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address}
							</span>
						)}
						{advantage > 0 && (
							<span
								data-testid={`material-advantage-${color}`}
								className="rounded bg-amber-500/20 px-1.5 py-0.5 text-xs font-bold text-amber-300"
							>
								+{advantage}
							</span>
						)}
					</div>
					<div className="text-xs text-white/70">
						<span className="capitalize">{color}</span>
						{rating !== null && rating !== undefined ? ` · ${rating}` : ""}
						{wagerAmount ? ` · ${wagerAmount} XLM` : ""}
					</div>
					{isDisconnected && (
						<div
							data-testid={`disconnect-banner-${color}`}
							className="mt-1 rounded bg-red-950/80 px-2 py-0.5 text-[11px] font-medium text-red-400 border border-red-500/30"
						>
							Player Disconnected
						</div>
					)}
				</div>

				{showClocks && (
					<div
						data-testid={`clock-container-${color}`}
						className={isLowTime ? "animate-pulse text-red-400 font-bold" : ""}
					>
						<GameTimer
							secondsLeft={clockSeconds}
							totalSeconds={totalSeconds}
							isCurrentTurn={isTurn}
							isClockRunning={isTurn}
						/>
					</div>
				)}
			</div>
		);
	};

	return (
		<div className="w-full flex flex-col gap-2">
			{isGameOver && (
				<div
					data-testid="game-over-banner"
					className="rounded-lg bg-indigo-950/80 border border-indigo-500/40 px-3 py-2 text-center text-sm font-semibold text-indigo-200"
				>
					{gameOverReason || "Game Over"}
				</div>
			)}
			<div className="grid grid-cols-2 gap-3">
				{renderPlayerCard(
					"white",
					whitePlayer,
					whiteAddress,
					whiteRating,
					whiteClock,
					whiteMaterialAdvantage,
					isWhiteDisconnected,
				)}
				{renderPlayerCard(
					"black",
					blackPlayer,
					blackAddress,
					blackRating,
					blackClock,
					blackMaterialAdvantage,
					isBlackDisconnected,
				)}
			</div>
		</div>
	);
}
