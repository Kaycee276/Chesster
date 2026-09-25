import { boardToFen } from "./chessUtils";

/**
 * Engine evaluation, always expressed from White's point of view.
 * - `scoreCp`: centipawns (positive = White is better). For forced mates it is
 *   ±MATE_SCORE_CP so the sign always tells who is winning.
 * - `mate`: signed moves to mate (positive = White mates), 0 when the side to
 *   move is already checkmated, or null when no mate was found.
 */
export interface EngineEvaluation {
	fen: string;
	depth: number;
	scoreCp: number;
	mate: number | null;
	bestMove: string | null;
	/** True once the search reached the requested depth. */
	final: boolean;
}

export interface UciInfo {
	depth: number;
	multipv: number;
	/** Score from the side to move's point of view. */
	score: { type: "cp" | "mate"; value: number };
	/** Set when the score is only a lower/upper bound (aspiration re-search). */
	bound: "lowerbound" | "upperbound" | null;
	pv: string[];
}

export const MATE_SCORE_CP = 100_000;

// Lichess win-probability coefficient: maps centipawns onto a 0-100% scale.
const WIN_PERCENT_COEFFICIENT = 0.00368208;

/**
 * Parses a UCI `info` line. Returns null for lines without a score
 * (e.g. `info depth 5 currmove e2e4 currmovenumber 1`).
 */
export function parseUciInfo(line: string): UciInfo | null {
	const tokens = line.trim().split(/\s+/);
	if (tokens[0] !== "info") return null;

	let depth: number | null = null;
	let multipv = 1;
	let score: UciInfo["score"] | null = null;
	let bound: UciInfo["bound"] = null;
	let pv: string[] = [];

	for (let i = 1; i < tokens.length; i++) {
		switch (tokens[i]) {
			case "depth":
				depth = Number(tokens[++i]);
				break;
			case "multipv":
				multipv = Number(tokens[++i]);
				break;
			case "score": {
				const type = tokens[++i];
				const value = Number(tokens[++i]);
				if ((type === "cp" || type === "mate") && Number.isFinite(value)) {
					score = { type, value };
				}
				break;
			}
			case "lowerbound":
			case "upperbound":
				bound = tokens[i] as UciInfo["bound"];
				break;
			case "pv":
				pv = tokens.slice(i + 1);
				i = tokens.length;
				break;
		}
	}

	if (depth === null || !Number.isFinite(depth) || !score) return null;
	return { depth, multipv, score, bound, pv };
}

/**
 * Converts a side-to-move UCI score into a White-perspective evaluation.
 */
export function toWhitePerspective(
	score: UciInfo["score"],
	sideToMove: "w" | "b",
): Pick<EngineEvaluation, "scoreCp" | "mate"> {
	const sign = sideToMove === "w" ? 1 : -1;

	if (score.type === "cp") {
		// `|| 0` avoids -0 for level positions with Black to move.
		return { scoreCp: score.value * sign || 0, mate: null };
	}

	if (score.value === 0) {
		// The side to move is checkmated, so the other side has won.
		return { scoreCp: -sign * MATE_SCORE_CP, mate: 0 };
	}

	const mate = score.value * sign;
	return { scoreCp: Math.sign(mate) * MATE_SCORE_CP, mate };
}

/** Returns the side to move ("w" | "b") encoded in a FEN string. */
export function fenSideToMove(fen: string): "w" | "b" {
	return fen.split(" ")[1] === "b" ? "b" : "w";
}

/**
 * Share of the bar (0-100) filled by White:
 *   50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1)
 * Forced mates fill the bar completely for the winning side.
 */
export function evaluationToWhitePercent(scoreCp: number, mate: number | null = null): number {
	if (mate !== null) return scoreCp > 0 ? 100 : 0;
	const percent = 50 + 50 * (2 / (1 + Math.exp(-WIN_PERCENT_COEFFICIENT * scoreCp)) - 1);
	return Math.max(0, Math.min(100, percent));
}

/**
 * Human-readable evaluation label: "+1.5", "-3.2", "0.0", "M4", "-M4",
 * or the final result ("1-0" / "0-1") when the position is checkmate.
 */
export function formatEvaluation(scoreCp: number, mate: number | null = null): string {
	if (mate !== null) {
		if (mate === 0) return scoreCp > 0 ? "1-0" : "0-1";
		return `${mate < 0 ? "-" : ""}M${Math.abs(mate)}`;
	}
	const pawns = (scoreCp / 100).toFixed(1);
	return scoreCp > 0 ? `+${pawns}` : pawns === "-0.0" ? "0.0" : pawns;
}

/**
 * Infers castling rights from piece placement: a right is kept while the king
 * and the corresponding rook are still on their starting squares. The game
 * state does not record whether they moved and came back, so this is the best
 * available approximation for evaluation purposes.
 */
export function inferCastlingRights(board: string[][]): string {
	let rights = "";
	if (board[7]?.[4] === "K") {
		if (board[7][7] === "R") rights += "K";
		if (board[7][0] === "R") rights += "Q";
	}
	if (board[0]?.[4] === "k") {
		if (board[0][7] === "r") rights += "k";
		if (board[0][0] === "r") rights += "q";
	}
	return rights || "-";
}

/**
 * Builds a FEN suitable for the engine, or null when the board could crash or
 * confuse it (malformed grid, missing/extra kings, pawns on a back rank).
 */
export function toEngineFen(board: string[][], turn: "white" | "black"): string | null {
	if (board.length !== 8 || board.some((row) => row.length !== 8)) return null;

	let whiteKings = 0;
	let blackKings = 0;
	for (let r = 0; r < 8; r++) {
		for (const piece of board[r]) {
			if (piece === "K") whiteKings++;
			else if (piece === "k") blackKings++;
			else if (piece === "P" || piece === "p") {
				if (r === 0 || r === 7) return null;
			} else if (piece !== "." && !"QRBNqrbn".includes(piece)) return null;
		}
	}
	if (whiteKings !== 1 || blackKings !== 1) return null;

	const [placement, side, , enPassant, halfmove, fullmove] = boardToFen(board, turn).split(" ");
	return [placement, side, inferCastlingRights(board), enPassant, halfmove, fullmove].join(" ");
}
