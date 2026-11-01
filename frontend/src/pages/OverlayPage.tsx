import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { api } from "../api/gameApi";
import { fetchPlayerProfile } from "../api/profileApi";
import { socketService } from "../api/socket";
import BroadcastChessBoard from "../components/BroadcastChessBoard";
import EvaluationBar from "../components/EvaluationBar";
import GameTimer from "../components/TurnTimer";
import { useStockfishEvaluation } from "../hooks/useStockfishEvaluation";
import { useGameStore } from "../store/gameStore";
import type { GameState } from "../types/game";
import { toEngineFen } from "../utils/engineEvaluation";
import { parseOverlayOptions } from "../utils/overlayOptions";

function PlayerBadge({ label, address, active, secondsLeft, totalSeconds, showClock, wager }: {
	label: string;
	address?: string | null;
	active: boolean;
	secondsLeft: number;
	totalSeconds: number;
	showClock: boolean;
	wager?: string | number | null;
}) {
	const [name, setName] = useState(label);
	const [rating, setRating] = useState<number | null>(null);

	useEffect(() => {
		if (!address) return;
		const controller = new AbortController();
		fetchPlayerProfile(address, controller.signal).then((profile) => {
			setName(profile.username || label);
			setRating(profile.rating);
		}).catch(() => {
			// The address and generic color label remain a useful fallback.
		});
		return () => controller.abort();
	}, [address, label]);

	return (
		<div className={`flex min-w-0 items-center justify-between gap-3 rounded-xl border px-4 py-3 backdrop-blur-md ${active ? "border-cyan-300 bg-slate-950/90 shadow-[0_0_24px_rgba(34,211,238,.25)]" : "border-white/15 bg-slate-950/75"}`}>
			<div className="min-w-0">
				<div className="truncate font-semibold text-white">{name}</div>
				<div className="text-xs text-white/70">{label}{rating !== null ? ` · ${rating}` : ""}{wager ? ` · ${wager} XLM` : ""}</div>
			</div>
			{showClock && <GameTimer secondsLeft={secondsLeft} totalSeconds={totalSeconds} isCurrentTurn={active} isClockRunning={active} />}
		</div>
	);
}

export default function OverlayPage() {
	const params = useParams<{ gameCode?: string; code?: string }>();
	const gameCode = params.gameCode ?? params.code;
	const [searchParams] = useSearchParams();
	const options = useMemo(() => parseOverlayOptions(searchParams.toString()), [searchParams]);
	const updateGameState = useGameStore((s) => s.updateGameState);
	const board = useGameStore((s) => s.board);
	const playerColor = useGameStore((s) => s.playerColor);
	const currentTurn = useGameStore((s) => s.currentTurn);
	const secondsLeft = useGameStore((s) => s.secondsLeft);
	const timeControlSeconds = useGameStore((s) => s.timeControlSeconds);
	const wagerAmount = useGameStore((s) => s.wagerAmount);
	const orientation = options.color ?? playerColor ?? "white";
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [game, setGame] = useState<GameState | null>(null);
	const fen = useMemo(() => board.length === 8 ? toEngineFen(board, currentTurn) : null, [board, currentTurn]);
	const { evaluation } = useStockfishEvaluation(fen, { enabled: options.showEvaluation });

	useEffect(() => {
		const previousBackground = document.body.style.background;
		const previousColor = document.body.style.color;
		document.body.style.background = options.transparent ? "transparent" : "#020617";
		document.body.style.color = "white";
		return () => {
			document.body.style.background = previousBackground;
			document.body.style.color = previousColor;
		};
	}, [options.transparent]);

	useEffect(() => {
		if (!gameCode) return;
		let active = true;
		useGameStore.setState({ isStreamerMode: true, gameCode });
		api.getGame(gameCode).then((res) => {
			if (!active) return;
			if (res.success && res.data) {
				setGame(res.data);
				updateGameState(res.data);
			} else {
				setError("This game could not be found.");
			}
		}).catch(() => {
			if (active) setError("Unable to load this game. Check the game code and try again.");
		}).finally(() => {
			if (active) setLoading(false);
		});

		socketService.connect();
		socketService.joinGame(gameCode);
		socketService.onGameUpdate((data) => {
			if (!active) return;
			setGame(data);
			updateGameState(data);
		});
		return () => {
			active = false;
			socketService.offGameUpdate();
			socketService.leaveGame(gameCode);
			socketService.disconnect();
		};
	}, [gameCode, updateGameState]);

	if (!gameCode) return <main role="alert" className="flex min-h-screen items-center justify-center p-6 text-center text-white">A game code is required for this overlay.</main>;
	if (loading) return <main role="status" className="flex min-h-screen items-center justify-center font-mono text-white">Loading stream overlay…</main>;
	if (error || !game) return <main role="alert" className="flex min-h-screen items-center justify-center p-6 text-center text-white">{error ?? "Game data is unavailable."}</main>;

	const totalSeconds = game.time_control_seconds ?? timeControlSeconds;
	const whiteClock = currentTurn === "white" ? secondsLeft : game.white_time_left ?? totalSeconds;
	const blackClock = currentTurn === "black" ? secondsLeft : game.black_time_left ?? totalSeconds;
	const wager = wagerAmount ?? game.wager_amount;
	return (
		<main className={`flex min-h-screen w-full flex-col items-center justify-center gap-3 p-3 ${options.transparent ? "bg-transparent" : "bg-slate-950"}`}>
			<div className="w-full max-w-4xl">
				<div className="mb-3 grid grid-cols-2 gap-3">
					<PlayerBadge label="White" address={game.player_white_address} active={currentTurn === "white"} secondsLeft={whiteClock} totalSeconds={totalSeconds} showClock={options.showClocks} wager={wager} />
					<PlayerBadge label="Black" address={game.player_black_address} active={currentTurn === "black"} secondsLeft={blackClock} totalSeconds={totalSeconds} showClock={options.showClocks} wager={wager} />
				</div>
				<div className="mx-auto flex w-full max-w-[min(82vh,760px)] items-stretch gap-2">
					{options.showEvaluation && <EvaluationBar scoreCp={evaluation?.scoreCp ?? 0} mate={evaluation?.mate ?? null} depth={evaluation?.depth} orientation={orientation} loading={!evaluation} />}
					<div className="min-w-0 flex-1"><BroadcastChessBoard board={board} orientation={orientation} theme={options.theme} /></div>
				</div>
			</div>
		</main>
	);
}
