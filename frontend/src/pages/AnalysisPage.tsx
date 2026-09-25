import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Upload, Hash, X, Loader2, GitBranch } from "lucide-react";
import MoveNavigator from "../components/MoveNavigator";
import PromotionModal from "../components/PromotionModal";
import { useToastStore } from "../store/toastStore";
import { api } from "../api/gameApi";
import type { MoveRecord } from "../types/game";
import {
	INITIAL_BOARD,
	getPossibleMoves,
	applyMove,
	squareToAlgebraic,
} from "../utils/chessUtils";
import { loadPgn, PgnParseError, type ReplayedMove } from "../utils/pgnParser";

const PIECE_SYMBOLS: Record<string, string> = {
	K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙",
	k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟",
};

const WHITE_PIECE_STYLE: React.CSSProperties = {
	color: "#ffffff",
	textShadow: "-1.5px -1.5px 0 #000, 1.5px -1.5px 0 #000, -1.5px 1.5px 0 #000, 1.5px 1.5px 0 #000",
	WebkitTextStroke: "0.5px #000",
};

const BLACK_PIECE_STYLE: React.CSSProperties = {
	color: "#111111",
	textShadow: "-1.5px -1.5px 0 #fff, 1.5px -1.5px 0 #fff, -1.5px 1.5px 0 #fff, 1.5px 1.5px 0 #fff",
	WebkitTextStroke: "0.5px #fff",
};

/** Turns a raw MoveRecord (from a live/finished match) into a ReplayedMove
 * the analysis board understands. Match records don't carry SAN text, so a
 * simple coordinate label is used for display instead. */
function moveRecordToReplayed(m: MoveRecord, index: number): ReplayedMove {
	return {
		moveNumber: Math.floor(index / 2) + 1,
		color: m.player,
		san: `${squareToAlgebraic(m.from_position)}${m.piece.toLowerCase() === "p" ? "" : m.piece.toUpperCase()}-${squareToAlgebraic(m.to_position)}`,
		from: m.from_position,
		to: m.to_position,
		piece: m.piece,
		isCapture: false,
		isCheck: !!m.is_check,
		isCheckmate: !!m.is_checkmate,
		boardAfter: m.board_state_after,
	};
}

export default function AnalysisPage() {
	const navigate = useNavigate();
	const { addToast } = useToastStore();

	const [moves, setMoves] = useState<ReplayedMove[]>([]);
	const [headers, setHeaders] = useState<Record<string, string>>({});
	const [result, setResult] = useState("*");
	const [currentIndex, setCurrentIndex] = useState(-1); // -1 = starting position
	const [isPlaying, setIsPlaying] = useState(false);

	const [branch, setBranch] = useState<ReplayedMove[] | null>(null);
	const [selectedSquare, setSelectedSquare] = useState<[number, number] | null>(null);
	const [promotionPending, setPromotionPending] = useState<{ from: [number, number]; to: [number, number] } | null>(null);

	const [showPgnModal, setShowPgnModal] = useState(false);
	const [pgnInput, setPgnInput] = useState("");
	const [matchIdInput, setMatchIdInput] = useState("");
	const [loadingMatch, setLoadingMatch] = useState(false);

	const goToMove = (index: number) => {
		setIsPlaying(false);
		setBranch(null);
		setSelectedSquare(null);
		setCurrentIndex(Math.max(-1, Math.min(moves.length - 1, index)));
	};

	// ── Keyboard navigation (#251) ─────────────────────────────────────────────
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			const target = e.target as HTMLElement | null;
			if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;

			if (e.key === "ArrowLeft") {
				e.preventDefault();
				goToMove(currentIndex - 1);
			} else if (e.key === "ArrowRight") {
				e.preventDefault();
				goToMove(currentIndex + 1);
			} else if (e.key === "ArrowUp") {
				e.preventDefault();
				goToMove(-1);
			} else if (e.key === "ArrowDown") {
				e.preventDefault();
				goToMove(moves.length - 1);
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [currentIndex, moves.length]); // eslint-disable-line react-hooks/exhaustive-deps

	const baseBoard = currentIndex === -1 ? INITIAL_BOARD : moves[currentIndex].boardAfter;
	const currentBoard = branch && branch.length > 0 ? branch[branch.length - 1].boardAfter : baseBoard;

	const pliesPlayed = (currentIndex + 1) + (branch?.length ?? 0);
	const turnToMove: "white" | "black" = pliesPlayed % 2 === 0 ? "white" : "black";

	const isPlayerPieceOf = (piece: string, color: "white" | "black") =>
		piece !== "." && (color === "white" ? piece === piece.toUpperCase() : piece === piece.toLowerCase());

	// ── Branch exploration: play any legal candidate move from here (#251) ────
	const commitBranchMove = (from: [number, number], to: [number, number], promotion?: string) => {
		const { board: nextBoard, piece, isCapture } = applyMove(currentBoard, from, to, promotion);
		const move: ReplayedMove = {
			moveNumber: Math.floor(pliesPlayed / 2) + 1,
			color: turnToMove,
			san: `${squareToAlgebraic(from)}-${squareToAlgebraic(to)}${promotion ? `=${promotion.toUpperCase()}` : ""}`,
			from,
			to,
			piece,
			isCapture,
			isCheck: false,
			isCheckmate: false,
			boardAfter: nextBoard,
		};
		setBranch((prev) => [...(prev ?? []), move]);
		setSelectedSquare(null);
	};

	const handlePromote = (piece: string) => {
		if (!promotionPending) return;
		commitBranchMove(promotionPending.from, promotionPending.to, piece);
		setPromotionPending(null);
	};

	const handleSquareClick = (row: number, col: number) => {
		if (promotionPending) return;
		const piece = currentBoard[row][col];

		if (!selectedSquare) {
			if (piece === "." || !isPlayerPieceOf(piece, turnToMove)) return;
			setSelectedSquare([row, col]);
			return;
		}

		if (selectedSquare[0] === row && selectedSquare[1] === col) {
			setSelectedSquare(null);
			return;
		}

		if (isPlayerPieceOf(piece, turnToMove)) {
			setSelectedSquare([row, col]);
			return;
		}

		const legalMoves = getPossibleMoves(currentBoard, selectedSquare, turnToMove);
		if (!legalMoves.some(([r, c]) => r === row && c === col)) {
			setSelectedSquare(null);
			return;
		}

		const movingPiece = currentBoard[selectedSquare[0]][selectedSquare[1]];
		const isPromotion = movingPiece.toLowerCase() === "p" && (row === 0 || row === 7);
		if (isPromotion) {
			setPromotionPending({ from: selectedSquare, to: [row, col] });
			return;
		}

		commitBranchMove(selectedSquare, [row, col]);
	};

	// ── PGN import ──────────────────────────────────────────────────────────
	const handleImportPgn = () => {
		try {
			const parsed = loadPgn(pgnInput);
			setHeaders(parsed.headers);
			setResult(parsed.result);
			setMoves(parsed.moves);
			setCurrentIndex(-1);
			setBranch(null);
			setSelectedSquare(null);
			setShowPgnModal(false);
			setPgnInput("");
			addToast(`Imported ${parsed.moves.length} moves`, "success");
		} catch (err) {
			addToast(err instanceof PgnParseError ? err.message : "Failed to parse PGN", "error");
		}
	};

	// ── Match ID loader ─────────────────────────────────────────────────────
	const handleLoadMatch = async () => {
		const code = matchIdInput.trim();
		if (!code) return;
		setLoadingMatch(true);
		try {
			const data = await api.getMoves(code);
			const records: MoveRecord[] = Array.isArray(data.data) ? data.data : [];
			if (!data.success || records.length === 0) {
				addToast("No moves found for that match ID", "error");
				return;
			}
			setMoves(records.map(moveRecordToReplayed));
			setHeaders({ Event: `Match ${code}` });
			setResult("*");
			setCurrentIndex(-1);
			setBranch(null);
			setSelectedSquare(null);
			addToast(`Loaded ${records.length} moves from match ${code}`, "success");
		} catch {
			addToast("Failed to load that match", "error");
		} finally {
			setLoadingMatch(false);
		}
	};

	const moveRows = useMemo(() => {
		const rows: { num: number; white?: ReplayedMove; black?: ReplayedMove; whiteIndex: number; blackIndex: number }[] = [];
		for (let i = 0; i < moves.length; i += 2) {
			rows.push({
				num: Math.floor(i / 2) + 1,
				white: moves[i],
				black: moves[i + 1],
				whiteIndex: i,
				blackIndex: i + 1,
			});
		}
		return rows;
	}, [moves]);

	const isFlipped = false; // analysis board always shown from white's perspective

	return (
		<div className="h-dvh w-dvw overflow-hidden flex flex-col bg-(--bg) p-2 gap-2">
			{promotionPending && <PromotionModal color={turnToMove} onSelect={handlePromote} />}

			{showPgnModal && (
				<div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
					<div className="bg-(--bg) border border-(--border) rounded-2xl p-4 w-full max-w-lg flex flex-col gap-3">
						<div className="flex items-center justify-between">
							<h3 className="font-bold text-sm uppercase tracking-wide">Import PGN</h3>
							<button onClick={() => setShowPgnModal(false)} className="text-(--text-tertiary) hover:text-(--text)">
								<X size={18} />
							</button>
						</div>
						<textarea
							value={pgnInput}
							onChange={(e) => setPgnInput(e.target.value)}
							placeholder={'1. e4 e5 2. Nf3 Nc6 3. Bb5 ...'}
							rows={8}
							className="w-full bg-(--bg-secondary) border border-(--border) rounded-lg p-2 text-xs font-mono resize-none focus:outline-none focus:border-(--accent-primary)/60"
						/>
						<button
							onClick={handleImportPgn}
							disabled={!pgnInput.trim()}
							className="w-full py-2 rounded-lg bg-(--accent-dark) hover:bg-(--accent-primary) disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold transition-colors"
						>
							Import
						</button>
					</div>
				</div>
			)}

			{/* ── Header bar ── */}
			<div className="shrink-0 flex items-center justify-between gap-2 px-3 h-11 rounded-xl bg-(--bg-secondary) border border-(--border)">
				<button onClick={() => navigate("/")} className="flex items-center gap-1.5 text-sm text-(--text-secondary) hover:text-(--text) transition-colors">
					<ArrowLeft size={14} /> Lobby
				</button>
				<div className="flex items-center gap-2 min-w-0">
					{headers.White && headers.Black && (
						<span className="text-xs text-(--text-tertiary) truncate hidden sm:inline">
							{headers.White} vs {headers.Black}
							{result !== "*" ? ` · ${result}` : ""}
						</span>
					)}
					<button
						onClick={() => setShowPgnModal(true)}
						className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-(--bg) border border-(--border) hover:border-(--accent-primary)/60 text-xs font-semibold transition-colors"
					>
						<Upload size={13} /> Paste PGN
					</button>
					<div className="flex items-center gap-1">
						<Hash size={12} className="text-(--text-tertiary) shrink-0" />
						<input
							value={matchIdInput}
							onChange={(e) => setMatchIdInput(e.target.value)}
							onKeyDown={(e) => e.key === "Enter" && handleLoadMatch()}
							placeholder="Match code"
							className="w-24 bg-(--bg) border border-(--border) rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-(--accent-primary)/60"
						/>
						<button
							onClick={handleLoadMatch}
							disabled={loadingMatch || !matchIdInput.trim()}
							className="px-2.5 py-1.5 rounded-lg bg-(--bg) border border-(--border) hover:border-(--accent-primary)/60 disabled:opacity-40 text-xs font-semibold transition-colors"
						>
							{loadingMatch ? <Loader2 size={13} className="animate-spin" /> : "Load"}
						</button>
					</div>
				</div>
			</div>

			{/* ── Board + move list ── */}
			<div className="flex-1 min-h-0 flex flex-col md:flex-row gap-2">
				<div className="flex-1 min-h-0 flex items-center justify-center overflow-hidden">
					<div className="w-full max-w-[min(90vw,70vh)] aspect-square">
						<div
							className="w-full h-full rounded-sm overflow-hidden shadow-2xl"
							style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gridTemplateRows: "repeat(8, 1fr)" }}
						>
							{currentBoard.map((rowArr, rowIndex) =>
								rowArr.map((piece, colIndex) => {
									const row = isFlipped ? 7 - rowIndex : rowIndex;
									const col = isFlipped ? 7 - colIndex : colIndex;
									const isLight = (row + col) % 2 === 0;
									const selected = selectedSquare && selectedSquare[0] === row && selectedSquare[1] === col;
									const possible = selectedSquare
										? getPossibleMoves(currentBoard, selectedSquare, turnToMove).some(([r, c]) => r === row && c === col)
										: false;
									const isCaptureTarget = possible && piece !== ".";
									return (
										<div
											key={`${row}-${col}`}
											onClick={() => handleSquareClick(row, col)}
											className={`relative flex items-center justify-center cursor-pointer transition-[filter] hover:brightness-110 ${
												isLight ? "bg-(--sq-light)" : "bg-(--sq-dark)"
											} ${selected ? "bg-yellow-400/75" : ""}`}
										>
											{possible && !isCaptureTarget && (
												<div className="absolute rounded-full bg-black/30 dark:bg-white/25 pointer-events-none w-[28%] h-[28%]" />
											)}
											{isCaptureTarget && (
												<div className="absolute rounded-full border-[3px] border-yellow-400/90 pointer-events-none w-[70%] h-[70%]" />
											)}
											{piece !== "." && (
												<span
													className="leading-none pointer-events-none text-[7vw] sm:text-4xl"
													style={piece === piece.toUpperCase() ? WHITE_PIECE_STYLE : BLACK_PIECE_STYLE}
												>
													{PIECE_SYMBOLS[piece]}
												</span>
											)}
										</div>
									);
								}),
							)}
						</div>
					</div>
				</div>

				<div className="md:w-72 shrink-0 flex flex-col gap-2 min-h-0">
					<MoveNavigator
						currentMoveIndex={currentIndex}
						totalMoves={moves.length}
						isPlaying={isPlaying}
						onMoveChange={goToMove}
						onTogglePlay={() => setIsPlaying((p) => !p)}
					/>

					<div className="flex-1 min-h-0 overflow-y-auto rounded-xl bg-(--bg-secondary) border border-(--border)">
						{moves.length === 0 ? (
							<p className="text-xs text-(--text-tertiary) text-center p-4">
								Paste a PGN or load a match code to begin.
							</p>
						) : (
							<table className="w-full text-xs font-mono">
								<tbody>
									{moveRows.map((r) => (
										<tr key={r.num} className="border-b border-(--border)/50 last:border-0">
											<td className="px-2 py-1 text-(--text-tertiary) w-8">{r.num}.</td>
											<td
												onClick={() => goToMove(r.whiteIndex)}
												className={`px-2 py-1 cursor-pointer hover:bg-(--bg)/60 ${
													!branch && currentIndex === r.whiteIndex ? "bg-(--accent-dark)/40 font-bold" : ""
												}`}
											>
												{r.white?.san}
											</td>
											<td
												onClick={() => r.black && goToMove(r.blackIndex)}
												className={`px-2 py-1 cursor-pointer hover:bg-(--bg)/60 ${
													!branch && r.black && currentIndex === r.blackIndex ? "bg-(--accent-dark)/40 font-bold" : ""
												}`}
											>
												{r.black?.san ?? ""}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						)}
					</div>

					{branch && branch.length > 0 && (
						<div className="shrink-0 rounded-xl bg-(--bg-secondary) border border-(--accent-primary)/40 p-2 flex flex-col gap-1.5">
							<div className="flex items-center justify-between">
								<span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-(--accent-primary)">
									<GitBranch size={11} /> Branch
								</span>
								<button
									onClick={() => setBranch(null)}
									className="text-[10px] text-(--text-tertiary) hover:text-(--text) transition-colors"
								>
									Back to main line
								</button>
							</div>
							<div className="flex flex-wrap gap-1 text-xs font-mono text-(--text-secondary)">
								{branch.map((m, i) => (
									<span key={i}>{m.san}</span>
								))}
							</div>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
