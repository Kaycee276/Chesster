import GameTimer from "./TurnTimer";

export type BroadcastSide = "white" | "black";

export interface BroadcastPlayer {
	name: string;
	address?: string | null;
	rating?: number | null;
	wager?: string | number | null;
}

export interface BroadcastGameOver {
	result: string;
	winner?: BroadcastSide | null;
}

interface BroadcastScoreboardProps {
	whitePlayer: string | BroadcastPlayer;
	blackPlayer: string | BroadcastPlayer;
	currentTurn: BroadcastSide;
	whiteSecondsLeft?: number;
	blackSecondsLeft?: number;
	totalSeconds?: number;
	showClocks?: boolean;
	/** Positive values favour White, negative values favour Black. */
	materialAdvantage?: number;
	disconnected?: BroadcastSide | null;
	gameOver?: BroadcastGameOver | null;
}

const LOW_TIME_SECONDS = 10;

function normalizePlayer(player: string | BroadcastPlayer, fallbackName: string): BroadcastPlayer {
	if (typeof player === "string") return { name: player };
	return { ...player, name: player.name || fallbackName };
}

function PlayerCard({
	side,
	player,
	active,
	secondsLeft,
	totalSeconds,
	showClock,
	advantage,
	disconnected,
	winner,
}: {
	side: BroadcastSide;
	player: BroadcastPlayer;
	active: boolean;
	secondsLeft: number;
	totalSeconds: number;
	showClock: boolean;
	advantage: number;
	disconnected: boolean;
	winner: boolean;
}) {
	const label = side === "white" ? "White" : "Black";
	const isLowTime = showClock && secondsLeft <= LOW_TIME_SECONDS;

	return (
		<div
			role="group"
			aria-label={`${label} player${active ? ", active turn" : ""}`}
			aria-current={active ? "true" : undefined}
			data-side={side}
			data-active={active ? "true" : "false"}
			data-low-time={isLowTime ? "true" : undefined}
			data-disconnected={disconnected ? "true" : undefined}
			data-winner={winner ? "true" : undefined}
			className={`flex min-w-0 items-center justify-between gap-3 rounded-xl border px-4 py-3 backdrop-blur-md transition-colors ${
				active
					? "border-emerald-500 bg-slate-950/90 shadow-[0_0_24px_rgba(16,185,129,.25)]"
					: "border-white/15 bg-slate-950/75"
			} ${disconnected ? "opacity-60" : ""} ${winner ? "ring-2 ring-amber-300" : ""}`}
		>
			<div className="min-w-0">
				<div className="flex min-w-0 items-center gap-2">
					<span className="truncate font-semibold text-white">{player.name}</span>
					{advantage !== 0 && (
						<span
							aria-label={`${label} material advantage: ${advantage > 0 ? "+" : "−"}${Math.abs(advantage)}`}
							className="shrink-0 text-xs font-bold tabular-nums text-emerald-300"
						>
							{advantage > 0 ? "+" : "−"}
							{Math.abs(advantage)}
						</span>
					)}
				</div>
				<div className="truncate text-xs text-white/70">
					{label}
					{player.rating !== undefined && player.rating !== null ? ` · ${player.rating}` : ""}
					{player.address ? ` · ${player.address.slice(0, 4)}…${player.address.slice(-4)}` : ""}
					{player.wager ? ` · ${player.wager} XLM` : ""}
				</div>
			</div>
			{showClock && (
				<GameTimer
					secondsLeft={Number.isFinite(secondsLeft) ? Math.max(0, secondsLeft) : 0}
					totalSeconds={totalSeconds}
					isCurrentTurn={active}
					isClockRunning={active}
				/>
			)}
		</div>
	);
}

export default function BroadcastScoreboard({
	whitePlayer,
	blackPlayer,
	currentTurn,
	whiteSecondsLeft = 0,
	blackSecondsLeft = 0,
	totalSeconds = 0,
	showClocks = true,
	materialAdvantage = 0,
	disconnected = null,
	gameOver = null,
}: BroadcastScoreboardProps) {
	const white = normalizePlayer(whitePlayer, "White");
	const black = normalizePlayer(blackPlayer, "Black");
	const winner = gameOver?.winner ?? null;
	const resultText = gameOver
		? winner
			? `${winner === "white" ? "White" : "Black"} wins by ${gameOver.result}`
			: gameOver.result === "draw"
				? "Draw"
				: `Game over: ${gameOver.result}`
		: null;

	return (
		<section aria-label="Broadcast scoreboard" className="w-full">
			<div className="mb-3 grid grid-cols-2 gap-3">
				<PlayerCard
					side="white"
					player={white}
					active={currentTurn === "white"}
					secondsLeft={whiteSecondsLeft}
					totalSeconds={totalSeconds}
					showClock={showClocks}
					advantage={materialAdvantage > 0 ? materialAdvantage : 0}
					disconnected={disconnected === "white"}
					winner={winner === "white"}
				/>
				<PlayerCard
					side="black"
					player={black}
					active={currentTurn === "black"}
					secondsLeft={blackSecondsLeft}
					totalSeconds={totalSeconds}
					showClock={showClocks}
					advantage={materialAdvantage < 0 ? materialAdvantage : 0}
					disconnected={disconnected === "black"}
					winner={winner === "black"}
				/>
			</div>
			{disconnected && (
				<p role="status" className="mb-3 rounded-lg border border-amber-400/60 bg-amber-950/50 px-3 py-2 text-center text-sm font-semibold text-amber-200">
					{disconnected === "white" ? "White" : "Black"} disconnected
				</p>
			)}
			{resultText && (
				<p role="status" className="mb-3 rounded-lg border border-white/20 bg-slate-900/80 px-3 py-2 text-center text-sm font-semibold text-white">
					{resultText}
				</p>
			)}
		</section>
	);
}
