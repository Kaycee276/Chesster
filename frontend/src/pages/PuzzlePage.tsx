import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { type Puzzle, puzzleApi } from "../api/puzzleApi";
import { useToastStore } from "../store/toastStore";
import { Loader2, RotateCcw, Lightbulb, Home } from "lucide-react";

interface PuzzleMove {
	from: [number, number];
	to: [number, number];
	promotion?: string;
}

const PIECE_SYMBOLS: Record<string, string> = {
	K: "♔",
	Q: "♕",
	R: "♖",
	B: "♗",
	N: "♘",
	P: "♙",
	k: "♚",
	q: "♛",
	r: "♜",
	b: "♝",
	n: "♞",
	p: "♟",
};

const WHITE_PIECE_STYLE: React.CSSProperties = {
	color: "#ffffff",
	textShadow:
		"-1.5px -1.5px 0 #000, 1.5px -1.5px 0 #000, -1.5px 1.5px 0 #000, 1.5px 1.5px 0 #000",
	WebkitTextStroke: "0.5px #000",
};

const BLACK_PIECE_STYLE: React.CSSProperties = {
	color: "#111111",
	textShadow:
		"-1.5px -1.5px 0 #fff, 1.5px -1.5px 0 #fff, -1.5px 1.5px 0 #fff, 1.5px 1.5px 0 #fff",
	WebkitTextStroke: "0.5px #fff",
};

/**
 * Parse FEN notation and convert to board array (8x8).
 * Returns the piece placement part as a string[][] matching our board representation.
 */
function fenToBoard(fen: string): string[][] {
	const rows = fen.split(" ")[0].split("/");
	return rows.map((row) => {
		const result: string[] = [];
		for (const char of row) {
			if (/\d/.test(char)) {
				result.push(...Array(parseInt(char, 10)).fill("."));
			} else {
				result.push(char);
			}
		}
		return result;
	});
}

/**
 * Apply a move to the board: remove piece from 'from', place at 'to'.
 * Handles promotion if specified.
 */
function applyMove(
	board: string[][],
	move: PuzzleMove,
): string[][] {
	const newBoard = board.map((row) => [...row]);
	const piece = newBoard[move.from[0]][move.from[1]];

	// Remove piece from source
	newBoard[move.from[0]][move.from[1]] = ".";

	// Place piece at destination (apply promotion if needed)
	if (move.promotion) {
		newBoard[move.to[0]][move.to[1]] = move.promotion;
	} else {
		newBoard[move.to[0]][move.to[1]] = piece;
	}

	return newBoard;
}

/**
 * Determine whose turn it is based on the piece colors still on board and the sequence of moves.
 * For simplicity, we count the pieces: if black has fewer pieces, it's white's turn.
 * This is a heuristic and assumes the puzzle follows normal parity.
 */
function getTurnFromBoard(board: string[][]): "white" | "black" {
	let whitePieces = 0;
	let blackPieces = 0;
	for (const row of board) {
		for (const piece of row) {
			if (piece !== ".") {
				if (piece === piece.toUpperCase()) {
					whitePieces++;
				} else {
					blackPieces++;
				}
			}
		}
	}
	// Normally both sides start with 16 pieces. If counts are equal, white moves; otherwise black.
	// This is a simplification; ideally the puzzle FEN would include the turn indicator.
	return whitePieces > blackPieces ? "black" : "white";
}

function PuzzleBoard({
	board,
	onMove,
	highlightedSquare,
	lastMove,
}: {
	board: string[][];
	onMove: (from: [number, number], to: [number, number]) => void;
	highlightedSquare?: [number, number] | null;
	lastMove?: { from: [number, number]; to: [number, number] } | null;
}) {
	const boardWrapperRef = useRef<HTMLDivElement>(null);
	const [boardPx, setBoardPx] = useState(0);
	const [selectedSquare, setSelectedSquare] = useState<[number, number] | null>(null);

	useEffect(() => {
		const el = boardWrapperRef.current;
		if (!el) return;
		const update = () => setBoardPx(Math.min(el.clientWidth, el.clientHeight));
		const obs = new ResizeObserver(update);
		obs.observe(el);
		update();
		return () => obs.disconnect();
	}, []);

	const handleSquareClick = (row: number, col: number) => {
		if (!selectedSquare) {
			if (board[row][col] !== ".") {
				setSelectedSquare([row, col]);
			}
		} else {
			if (selectedSquare[0] === row && selectedSquare[1] === col) {
				setSelectedSquare(null);
			} else {
				onMove(selectedSquare, [row, col]);
				setSelectedSquare(null);
			}
		}
	};

	const isSelected = (row: number, col: number) =>
		selectedSquare && selectedSquare[0] === row && selectedSquare[1] === col;

	const isHighlighted = (row: number, col: number) =>
		highlightedSquare && highlightedSquare[0] === row && highlightedSquare[1] === col;

	const isLastMoveSquare = (row: number, col: number) =>
		lastMove &&
		((row === lastMove.from[0] && col === lastMove.from[1]) ||
			(row === lastMove.to[0] && col === lastMove.to[1]));

	return (
		<div
			ref={boardWrapperRef}
			className="relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden"
		>
			{boardPx > 0 && (
				<div
					className="rounded-sm overflow-hidden shadow-2xl"
					style={
						{
							width: boardPx,
							height: boardPx,
							display: "grid",
							gridTemplateColumns: "repeat(8, 1fr)",
							gridTemplateRows: "repeat(8, 1fr)",
							"--board-size": `${boardPx}px`,
						} as React.CSSProperties
					}
				>
					{board.map((row, rowIndex) =>
						row.map((piece, colIndex) => {
							const isLight = (rowIndex + colIndex) % 2 === 0;
							const selected = isSelected(rowIndex, colIndex);
							const highlighted = isHighlighted(rowIndex, colIndex);
							const lastMove_ = isLastMoveSquare(rowIndex, colIndex);

							return (
								<div
									key={`${rowIndex}-${colIndex}`}
									data-testid={`puzzle-square-${rowIndex}-${colIndex}`}
									className={`relative flex items-center justify-center cursor-pointer transition-[filter] hover:brightness-110 ${
										isLight ? "bg-(--sq-light)" : "bg-(--sq-dark)"
									} ${selected ? "bg-yellow-400/75" : ""} ${
										highlighted ? "ring-4 ring-blue-400 ring-inset" : ""
									} ${lastMove_ ? "bg-yellow-300/45" : ""}`}
									onClick={() => handleSquareClick(rowIndex, colIndex)}
									onTouchEnd={(e) => {
										e.preventDefault();
										handleSquareClick(rowIndex, colIndex);
									}}
								>
									{piece !== "." && (
										<span
											className="leading-none pointer-events-none"
											style={{
												fontSize: "calc(var(--board-size) / 8 * 0.72)",
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
			)}
		</div>
	);
}

function Confetti() {
	useEffect(() => {
		// Simple CSS-based confetti animation
		const canvas = document.createElement("canvas");
		canvas.width = window.innerWidth;
		canvas.height = window.innerHeight;
		canvas.style.position = "fixed";
		canvas.style.top = "0";
		canvas.style.left = "0";
		canvas.style.pointerEvents = "none";
		canvas.style.zIndex = "9999";
		document.body.appendChild(canvas);

		const ctx = canvas.getContext("2d");
		if (!ctx) {
			document.body.removeChild(canvas);
			return;
		}

		const confetti: Array<{
			x: number;
			y: number;
			vx: number;
			vy: number;
			size: number;
			color: string;
		}> = [];

		for (let i = 0; i < 100; i++) {
			confetti.push({
				x: Math.random() * canvas.width,
				y: Math.random() * canvas.height * 0.5 - canvas.height,
				vx: (Math.random() - 0.5) * 8,
				vy: Math.random() * 4 + 4,
				size: Math.random() * 4 + 2,
				color: ["#FFD700", "#FFA500", "#FF6347", "#00BFFF", "#32CD32"][
					Math.floor(Math.random() * 5)
				],
			});
		}

		let animationId: number;
		const animate = () => {
			ctx.clearRect(0, 0, canvas.width, canvas.height);

			for (const c of confetti) {
				c.y += c.vy;
				c.vy += 0.1; // gravity
				c.x += c.vx;

				if (c.y > canvas.height) continue;

				ctx.fillStyle = c.color;
				ctx.beginPath();
				ctx.arc(c.x, c.y, c.size, 0, Math.PI * 2);
				ctx.fill();
			}

			if (confetti.some((c) => c.y < canvas.height)) {
				animationId = requestAnimationFrame(animate);
			} else {
				document.body.removeChild(canvas);
			}
		};

		animationId = requestAnimationFrame(animate);

		return () => {
			cancelAnimationFrame(animationId);
			if (document.body.contains(canvas)) {
				document.body.removeChild(canvas);
			}
		};
	}, []);

	return null;
}

export default function PuzzlePage() {
	const navigate = useNavigate();
	const { addToast } = useToastStore();

	const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const [board, setBoard] = useState<string[][]>([]);
	const [moveStep, setMoveStep] = useState(0);
	const [status, setStatus] = useState<"solving" | "correct" | "failed">("solving");
	const [hintShown, setHintShown] = useState(false);
	const [lastMove, setLastMove] = useState<{
		from: [number, number];
		to: [number, number];
	} | null>(null);

	const autoReplyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const [showConfetti, setShowConfetti] = useState(false);

	// Fetch puzzle on mount
	useEffect(() => {
		const fetchPuzzle = async () => {
			setLoading(true);
			setError(null);
			try {
				const p = await puzzleApi.fetchDailyPuzzle();
				setPuzzle(p);
				setBoard(fenToBoard(p.fen));
				setMoveStep(0);
				setStatus("solving");
				setHintShown(false);
				setLastMove(null);
			} catch (err) {
				const msg = err instanceof Error ? err.message : "Failed to fetch puzzle";
				setError(msg);
				addToast(msg, "error");
			} finally {
				setLoading(false);
			}
		};

		fetchPuzzle();
	}, [addToast]);

	// Clean up auto-reply timer on unmount
	useEffect(() => {
		return () => {
			if (autoReplyTimerRef.current !== null) {
				clearTimeout(autoReplyTimerRef.current);
				autoReplyTimerRef.current = null;
			}
		};
	}, []);

	const handleMove = (from: [number, number], to: [number, number]) => {
		if (!puzzle || status !== "solving") return;

		const expectedMove = puzzle.solution[moveStep];
		if (!expectedMove) return;

		// Check if user move matches expected move
		const moveMatches =
			expectedMove.from[0] === from[0] &&
			expectedMove.from[1] === from[1] &&
			expectedMove.to[0] === to[0] &&
			expectedMove.to[1] === to[1];

		if (!moveMatches) {
			setStatus("failed");
			addToast("Incorrect move. Try again!", "error");
			// Allow retry by not advancing moveStep
			setTimeout(() => setStatus("solving"), 1500);
			return;
		}

		// Correct move: apply it to the board
		const newBoard = applyMove(board, expectedMove);
		setBoard(newBoard);
		setLastMove({ from, to });
		setMoveStep(moveStep + 1);

		// Check if puzzle is complete (all solution moves executed)
		if (moveStep + 1 >= puzzle.solution.length) {
			setStatus("correct");
			setShowConfetti(true);
			addToast("Puzzle solved! 🎉", "success");
			return;
		}

		// Auto-apply opponent's reply move after 300ms
		autoReplyTimerRef.current = setTimeout(() => {
			const opponentMove = puzzle.solution[moveStep + 1];
			if (!opponentMove) return;

			const newBoardAfterOpponent = applyMove(newBoard, opponentMove);
			setBoard(newBoardAfterOpponent);
			setLastMove({
				from: opponentMove.from,
				to: opponentMove.to,
			});
			setMoveStep(moveStep + 2);

			// Check again if puzzle is complete
			if (moveStep + 2 >= puzzle.solution.length) {
				setStatus("correct");
				setShowConfetti(true);
				addToast("Puzzle solved! 🎉", "success");
			}

			autoReplyTimerRef.current = null;
		}, 300);
	};

	const handleShowHint = () => {
		if (!puzzle || moveStep >= puzzle.solution.length) return;

		const nextMove = puzzle.solution[moveStep];
		setHintShown(true);

		// Highlight the source square only
		setTimeout(() => {
			setHintShown(false);
		}, 3000);

		addToast(
			`Hint: Move the piece on ${String.fromCharCode(97 + nextMove.from[1])}${8 - nextMove.from[0]}`,
			"info",
		);
	};

	const handleReset = () => {
		if (!puzzle) return;
		setBoard(fenToBoard(puzzle.fen));
		setMoveStep(0);
		setStatus("solving");
		setHintShown(false);
		setLastMove(null);
		if (autoReplyTimerRef.current !== null) {
			clearTimeout(autoReplyTimerRef.current);
			autoReplyTimerRef.current = null;
		}
	};

	if (loading) {
		return (
			<div className="flex flex-col items-center justify-center h-dvh w-dvw bg-(--bg) gap-4">
				<Loader2 size={32} className="text-(--text-secondary) animate-spin" />
				<p className="text-sm text-(--text-secondary)">Loading puzzle…</p>
			</div>
		);
	}

	if (error || !puzzle) {
		return (
			<div className="flex flex-col items-center justify-center h-dvh w-dvw bg-(--bg) gap-6 p-4">
				<div className="text-center flex flex-col gap-2">
					<h2 className="text-xl font-bold text-red-400">Failed to load puzzle</h2>
					<p className="text-sm text-(--text-secondary)">{error || "Unknown error"}</p>
				</div>
				<button
					onClick={() => navigate("/")}
					className="px-4 py-2 rounded-lg bg-(--accent-primary) hover:bg-(--accent-dark) text-white font-semibold transition-colors flex items-center gap-2"
				>
					<Home size={16} />
					Back to lobby
				</button>
			</div>
		);
	}

	const sideToMove = getTurnFromBoard(board);
	const isUsersTurn = sideToMove === puzzle.sideToMove;
	const hintSquare = hintShown && moveStep < puzzle.solution.length
		? puzzle.solution[moveStep].from
		: null;

	return (
		<div className="h-dvh w-dvw overflow-hidden flex flex-col bg-(--bg) select-none p-1 gap-1">
			{showConfetti && <Confetti />}

			{/* Header: Puzzle info */}
			<div className="shrink-0 flex items-center justify-between px-4 h-12 rounded-xl bg-(--bg-secondary) border border-(--border)">
				<div className="flex items-center gap-4">
					<div className="flex flex-col gap-0.5">
						<p className="text-xs font-semibold uppercase tracking-widest text-(--text-tertiary)">
							Daily Puzzle
						</p>
						<p className="text-sm font-bold text-(--text)">Rating: {puzzle.rating}</p>
					</div>
					<div className="flex items-center gap-1 flex-wrap">
						{puzzle.themes.map((theme) => (
							<span
								key={theme}
								className="px-2 py-0.5 text-xs font-semibold bg-(--accent-primary)/20 text-(--accent-primary) rounded-full border border-(--accent-primary)/30"
							>
								{theme}
							</span>
						))}
					</div>
				</div>
				<div className="text-right flex flex-col gap-0.5">
					<p className="text-xs font-semibold uppercase tracking-widest text-(--text-tertiary)">
						{puzzle.sideToMove === "white" ? "White to move" : "Black to move"}
					</p>
					<p className="text-sm font-mono text-(--text-secondary)">
						{moveStep} / {puzzle.solution.length} moves
					</p>
				</div>
			</div>

			{/* Board */}
			<PuzzleBoard
				board={board}
				onMove={handleMove}
				highlightedSquare={hintSquare}
				lastMove={lastMove}
			/>

			{/* Footer: Actions */}
			<div className="shrink-0 flex items-center justify-between px-3 h-10 rounded-xl bg-(--bg-secondary) border border-(--border) gap-2">
				<div className="flex items-center gap-1">
					<button
						onClick={handleReset}
						title="Reset puzzle to starting position"
						className="p-1.5 rounded-lg text-(--text-tertiary) hover:text-(--text) hover:bg-(--bg-tertiary) transition-colors"
					>
						<RotateCcw size={13} />
					</button>
					<span className="w-px h-4 bg-(--border) mx-0.5" />
					<button
						onClick={handleShowHint}
						disabled={hintShown || status !== "solving"}
						className="flex items-center gap-1.5 px-3 py-1.5 bg-(--accent-dark) hover:bg-(--accent-primary) text-white rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
					>
						<Lightbulb size={12} />
						Hint
					</button>
				</div>

				{status === "correct" && (
					<div className="flex items-center gap-2">
						<span className="text-green-400 font-bold text-sm">✓ Puzzle solved!</span>
						<button
							onClick={() => navigate("/")}
							className="px-3 py-1.5 bg-(--accent-primary) hover:bg-(--accent-dark) text-white rounded-lg text-xs font-semibold transition-colors"
						>
							Home
						</button>
					</div>
				)}

				{status === "failed" && (
					<span className="text-red-400 font-semibold text-xs">✗ Try again</span>
				)}

				{status === "solving" && (
					<span className="text-xs text-(--text-tertiary) italic">
						{isUsersTurn ? "Your turn" : "Opponent's turn"}
					</span>
				)}
			</div>
		</div>
	);
}
