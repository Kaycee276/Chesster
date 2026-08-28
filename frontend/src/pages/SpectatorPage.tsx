import { useEffect, useState, useMemo } from "react";
import { useParams } from "react-router-dom";
import { Eye, Users, TrendingUp, TrendingDown, Minus } from "lucide-react";

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

function EvaluationBar({ evalScore }: { evalScore: number }) {
	// evalScore in centipawns: positive = white advantage
	const clamped = Math.max(-1000, Math.min(1000, evalScore));
	const whitePercent = 50 + (clamped / 1000) * 45;
	const blackPercent = 100 - whitePercent;

	const label =
		Math.abs(evalScore) >= 900
			? evalScore > 0 ? "M+" : "M-"
			: (evalScore / 100).toFixed(1);

	return (
		<div className="flex flex-col items-center gap-1 select-none">
			<span className="text-xs font-mono text-(--text-secondary)">{evalScore > 0 ? "+" : ""}{evalScore >= 100 ? (evalScore / 100).toFixed(1) : evalScore}</span>
			<div className="w-6 h-48 rounded-full overflow-hidden border border-(--border) flex flex-col shadow-inner">
				<div
					className="bg-white transition-all duration-500"
					style={{ height: `${whitePercent}%` }}
				/>
				<div
					className="bg-gray-900 transition-all duration-500"
					style={{ height: `${blackPercent}%` }}
				/>
			</div>
			<span className="text-xs font-mono text-(--text-secondary)">{label}</span>
		</div>
	);
}

function SpectatorBoard({ board }: { board: string[][] }) {
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
			{board.map((row, ri) =>
				row.map((piece, ci) => {
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

export default function SpectatorPage() {
	const { gameCode } = useParams<{ gameCode: string }>();
	const [board] = useState(INITIAL_BOARD);
	const [moveHistory, setMoveHistory] = useState<string[]>([]);
	const [evalScore, setEvalScore] = useState(0);
	const [spectatorCount] = useState(1);

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
		const unsubscribe = () => {};
		return unsubscribe;
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
				<div className="flex items-center gap-1 text-xs text-(--text-secondary)">
					<Users size={14} />
					{spectatorCount}
				</div>
			</div>

			{/* Main content */}
			<div className="flex-1 flex items-center justify-center p-4 gap-4">
				{/* Eval bar */}
				<EvaluationBar evalScore={evalScore} />

				{/* Board */}
				<div className="w-full max-w-lg">
					<SpectatorBoard board={board} />
				</div>

				{/* Move list */}
				<div className="hidden md:flex flex-col w-48 bg-(--bg-secondary) border border-(--border) rounded-xl p-3 gap-2 h-full max-h-[80vh]">
					<h3 className="text-xs font-bold uppercase tracking-wider text-(--text-tertiary)">
						Moves
					</h3>
					<div className="flex-1 overflow-y-auto text-xs font-mono text-(--text-secondary) space-y-0.5">
						{moveHistory.length === 0 && (
							<p className="text-(text-tertiary) italic">No moves yet</p>
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
					<span>Waiting for game updates...</span>
				</div>
			</div>
		</div>
	);
}
