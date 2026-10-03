import { useEffect, useState, useMemo, useRef } from "react";
import { useParams } from "react-router-dom";
import { Eye, Users, TrendingUp, TrendingDown, Minus, ArrowUpDown } from "lucide-react";
import EvaluationBar from "../components/EvaluationBar";
import { useStockfishEvaluation } from "../hooks/useStockfishEvaluation";
import { toEngineFen } from "../utils/engineEvaluation";
import { api } from "../api/gameApi";
import { socketService, type SpectatorReaction } from "../api/socket";
import type { GameState } from "../types/game";

type Orientation = "white" | "black";

const PIECE_SYMBOLS: Record<string, string> = {
	K: "\u2654", Q: "\u2655", R: "\u2656", B: "\u2657", N: "\u2658", P: "\u2659",
	k: "\u265A", q: "\u265B", r: "\u265C", b: "\u265D", n: "\u265E", p: "\u265F",
};

const PIECE_VALUES: Record<string, number> = {
	p: 1, n: 3, b: 3, r: 5, q: 9, k: 0,
	P: 1, N: 3, B: 3, R: 5, Q: 9, K: 0,
};

const WHITE_PIECE_STYLE: React.CSSProperties = {
	color: "#ffffff",
	textShadow:
		"-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000",
};

const BLACK_PIECE_STYLE: React.CSSProperties = {
	color: "#111111",
	textShadow:
		"-1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff, 1px 1px 0 #fff",
};

const INITIAL_BOARD: string[][] = [
	["r", "n", "b", "q", "k", "b", "n", "r"],
	["p", "p", "p", "p", "p", "p", "p", "p"],
	[".", ".", ".", ".", ".", ".", ".", "."],
	[".", ".", ".", ".", ".", ".", ".", "."],
	[".", ".", ".", ".", ".", ".", ".", "."],
	[".", ".", ".", ".", ".", ".", ".", "."],
	["P", "P", "P", "P", "P", "P", "P", "P"],
	["R", "N", "B", "Q", "K", "B", "N", "R"],
];

function SpectatorBoard({ board, orientation }: { board: string[][]; orientation: Orientation }) {
	const flipped = orientation === "black";
	const displayIndices = flipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];

	return (
		<div
			className="rounded-sm overflow-hidden shadow-2xl"
			style={{
				display: "grid",
				gridTemplateColumns: "repeat(8, 1fr)",
				gridTemplateRows: "repeat(8, 1fr)",
				width: "100%",
				aspectRatio: "1",
			}}
		>
			{displayIndices.map((ri) =>
				displayIndices.map((ci) => {
					const piece = board[ri]?.[ci] ?? ".";
					const isLight = (ri + ci) % 2 === 0;
					return (
						<div
							key={`${ri}-${ci}`}
							className={`flex items-center justify-center ${
								isLight ? "bg-(--sq-light)" : "bg-(--sq-dark)"
							}`}
						>
							{piece !== "." && (
								<span
									className="leading-none pointer-events-none"
									style={{
										fontSize: "min(5vw, 2.5rem)",
										...(piece === piece.toUpperCase()
											? WHITE_PIECE_STYLE
											: BLACK_PIECE_STYLE),
									}}
								>
									{PIECE_SYMBOLS[piece]}
								</span>
							)}
						</div>
					);
				}),
			)}
		</div>
	);
}

const REACTION_EMOJIS = ["🔥", "👏", "♟️", "🤯", "💀"];

function ReactionFloatingBar({ gameCode }: { gameCode: string }) {
	const reactionLocked = useRef(false);

	const sendReaction = (emoji: string) => {
		if (reactionLocked.current) return;
		reactionLocked.current = true;
		socketService.sendReaction(gameCode, emoji);
		window.setTimeout(() => {
			reactionLocked.current = false;
		}, 500);
	};

	return (
		<div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full border border-(--border) bg-(--bg-secondary)/95 p-2 shadow-xl backdrop-blur-sm">
			{REACTION_EMOJIS.map((emoji) => (
				<button
					type="button"
					key={emoji}
					onClick={() => sendReaction(emoji)}
					aria-label={`Send ${emoji} reaction`}
					className="rounded-full px-2 py-1 text-xl transition-transform hover:scale-125 focus-visible:scale-125"
				>
					{emoji}
				</button>
			))}
		</div>
	);
}

function FloatingReaction({ reaction }: { reaction: SpectatorReaction }) {
	return (
		<div
			className="pointer-events-none absolute bottom-20 z-10 text-3xl reaction-float-up"
			style={{ left: `${reaction.xOffset}%` }}
			aria-hidden="true"
		>
			{reaction.emoji}
		</div>
	);
}

export default function SpectatorPage() {
	const { gameCode } = useParams<{ gameCode: string }>();
	const [board, setBoard] = useState(INITIAL_BOARD);
	const [turn, setTurn] = useState<"white" | "black">("white");
	const [gameLoaded, setGameLoaded] = useState(false);
	const [orientation, setOrientation] = useState<Orientation>("white");
	const [moveHistory] = useState<string[]>([]);
	const [spectatorCount] = useState(1);
	const [reactions, setReactions] = useState<SpectatorReaction[]>([]);

	const fen = useMemo(() => toEngineFen(board, turn), [board, turn]);
	const { evaluation, status: engineStatus } = useStockfishEvaluation(fen);
	const showEvaluation = fen !== null && engineStatus !== "error" && engineStatus !== "unsupported";

	const whiteMaterial = useMemo(() => {
		let total = 0;
		for (const row of board) {
			for (const p of row) {
				if (p !== "." && p === p.toUpperCase()) {
					total += PIECE_VALUES[p] ?? 0;
				}
			}
		}
		return total;
	}, [board]);

	const blackMaterial = useMemo(() => {
		let total = 0;
		for (const row of board) {
			for (const p of row) {
				if (p !== "." && p === p.toLowerCase()) {
					total += PIECE_VALUES[p] ?? 0;
				}
			}
		}
		return total;
	}, [board]);

	useEffect(() => {
		if (!gameCode) return;
		let active = true;
		const socket = socketService.connect();
		socketService.joinGame(gameCode);

		const applyGameState = (game: GameState | undefined) => {
			if (!active || !game || !Array.isArray(game.board_state)) return;
			setBoard(game.board_state);
			if (game.current_turn === "white" || game.current_turn === "black") {
				setTurn(game.current_turn);
			}
			setGameLoaded(true);
		};

		socketService.onGameUpdate(applyGameState);
		socketService.onReaction((reaction) => {
			if (!active) return;
			setReactions((current) => [...current, reaction]);
			window.setTimeout(() => {
				setReactions((current) => current.filter((item) => item.id !== reaction.id));
			}, 2000);
		});

		// The API uses snake_case for persisted game fields.
		api.getGame(gameCode).then((res) => {
			if (active && res?.success) applyGameState(res.data);
		}).catch(() => {
			// Keep showing the last known position; live updates may still arrive.
		});

		return () => {
			active = false;
			socketService.offGameUpdate();
			socketService.offReaction();
			socketService.leaveGame(gameCode);
			socket.disconnect();
		};
	}, [gameCode]);

	return (
		<div className="min-h-screen bg-(--bg) flex flex-col">
			{/* Header */}
			<div className="shrink-0 flex items-center justify-between px-4 py-3 bg-(--bg-secondary) border-b border-(--border)">
				<div className="flex items-center gap-2">
					<Eye size={18} className="text-(--accent-primary)" />
					<span className="font-bold text-sm">Spectating</span>
					{gameCode && (
						<span className="text-xs text-(--text-tertiary) font-mono">
							{gameCode.slice(0, 8)}...
						</span>
					)}
				</div>
				<div className="flex items-center gap-3">
					<button
						type="button"
						onClick={() => setOrientation((o) => (o === "white" ? "black" : "white"))}
						className="flex items-center gap-1 text-xs text-(--text-secondary) hover:text-(--text) transition-colors"
						title="Flip board"
						aria-label="Flip board"
					>
						<ArrowUpDown size={14} />
						<span className="hidden sm:inline">Flip</span>
					</button>
					<div className="flex items-center gap-1 text-xs text-(--text-secondary)">
						<Users size={14} />
						{spectatorCount}
					</div>
				</div>
			</div>

			{/* Main content */}
			<div className="flex-1 flex flex-col lg:flex-row items-center justify-center p-4 gap-4">
				{/* Eval bar + board */}
				<div className="w-full max-w-lg flex items-stretch gap-2">
					{showEvaluation && (
						<EvaluationBar
							scoreCp={evaluation?.scoreCp ?? 0}
							mate={evaluation?.mate ?? null}
							depth={evaluation?.depth}
							orientation={orientation}
							loading={!evaluation}
						/>
					)}
					<div className="relative flex-1 min-w-0">
						<SpectatorBoard board={board} orientation={orientation} />
						{reactions.map((reaction) => (
							<FloatingReaction key={reaction.id} reaction={reaction} />
						))}
						{gameCode && <ReactionFloatingBar gameCode={gameCode} />}
					</div>
				</div>

				{/* Move list */}
				<div className="hidden md:flex flex-col w-48 bg-(--bg-secondary) border border-(--border) rounded-xl p-3 gap-2 h-full max-h-[80vh]">
					<h3 className="text-xs font-bold uppercase tracking-wider text-(--text-tertiary)">
						Moves
					</h3>
					<div className="flex-1 overflow-y-auto text-xs font-mono text-(--text-secondary) space-y-0.5">
						{moveHistory.length === 0 && (
							<p className="text-(--text-tertiary) italic">No moves yet</p>
						)}
						{moveHistory.map((move, i) => (
							<div key={i} className={i % 2 === 0 ? "text-(--text)" : "text-(--text-secondary)"}>
								{i % 2 === 0 && <span className="text-(--text-tertiary) mr-1">{Math.floor(i / 2) + 1}.</span>}
								{move}
							</div>
						))}
					</div>
					<div className="flex items-center justify-between pt-2 border-t border-(--border)">
						<div className="flex items-center gap-1 text-xs">
							<TrendingUp size={12} className="text-white" />
							<span className="font-mono">{whiteMaterial}</span>
						</div>
						<div className="flex items-center gap-1 text-xs">
							<span className="font-mono">{blackMaterial}</span>
							<TrendingDown size={12} className="text-gray-400" />
						</div>
					</div>
				</div>
			</div>

			{/* Bottom status bar */}
			<div className="shrink-0 flex items-center justify-center px-4 py-2 bg-(--bg-secondary) border-t border-(--border)">
				<div className="flex items-center gap-2 text-xs text-(--text-secondary)">
					<Minus size={12} />
					<span>
						{gameLoaded
							? `${turn === "white" ? "White" : "Black"} to move`
							: "Waiting for game updates..."}
					</span>
					{evaluation && (
						<span className="font-mono text-(--text-tertiary)">
							· Stockfish depth {evaluation.depth}
						</span>
					)}
				</div>
			</div>
		</div>
	);
}
