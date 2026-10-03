/**
 * sanResolver.ts
 *
 * Resolves a typed SAN move (e.g. "e4", "Qxd5+", "O-O", "e8=Q") against a
 * board position into the concrete from/to squares the game API expects,
 * or `null` when the text does not describe a legal move for the side to
 * move.
 *
 * This mirrors the tolerance of the PGN replay engine: it does not model
 * check/checkmate legality itself — a candidate is legal when a piece of
 * the side to move can reach the implied destination per the shared move
 * generator in `chessUtils`. The board mutation helper already refuses
 * illegal geometry, so `resolveSan` only has to translate notation.
 */

import {
	getPossibleMoves,
	algebraicToSquare,
	squareToAlgebraic,
} from "./chessUtils";

/** The parsed components of a typed SAN token. */
interface SanParts {
	/** Uppercase piece letter, or "P" for pawn moves. */
	piece: "P" | "N" | "B" | "R" | "Q" | "K";
	/** True when the move text marks a capture ("x" or pawn "exd5"). */
	isCapture: boolean;
	/** Disambiguation file letter, when present (e.g. "R1a3" → "a"). */
	fromFile?: string;
	/** Disambiguation rank digit, when present (e.g. "N1f3" → "1"). */
	fromRank?: string;
	/** Destination square in algebraic form ("e4"). */
	to: string;
	/** Promotion piece letter, when present ("e8=Q" → "Q"). */
	promotion?: string;
}

/** Parses a SAN token into its components; null when malformed. */
function parseSan(raw: string): SanParts | null {
	const token = raw.trim().replace(/[+#!?]+$/g, "");
	if (token.length === 0) return null;

	// Castling: king moves two squares from its current file towards the
	// rook side. The from square is resolved by the caller (find the king).
	let castleFile: number | null = null;
	if (/^O-O-O$|^0-0-0$/.test(token)) castleFile = 2; // queenside → c-file
	else if (/^O-O$|^0-0$/.test(token)) castleFile = 6; // kingside → g-file

	let parts: SanParts;
	if (castleFile !== null) {
		parts = { piece: "K", isCapture: false, to: "" };
		parts.castleFile = castleFile;
	} else {
		const match =
			/^([KQRBN])?([a-h])?([1-8])?(x)?([a-h][1-8])(?:=?([QRBN]))?$/.exec(
				token,
			);
		if (!match) return null;
		parts = {
			piece: (match[1] ?? "P") as SanParts["piece"],
			isCapture: match[4] === "x",
			fromFile: match[2],
			fromRank: match[3],
			to: match[5],
			promotion: match[6],
		};
	}
	return parts;
}

// Augment the interface for the castle marker (kept off the main interface
// so the documented shape above stays readable).
interface SanParts extends Record<string, unknown> {
	piece: "P" | "N" | "B" | "R" | "Q" | "K";
	isCapture: boolean;
	fromFile?: string;
	fromRank?: string;
	to: string;
	promotion?: string;
	castleFile?: number;
}

interface SanResolution {
	from: [number, number];
	to: [number, number];
	promotion?: string;
}

/**
 * Resolves `san` for the side given by `turn` against `board`.
 *
 * Returns the concrete from/to coordinates (plus promotion piece) that the
 * move API accepts, or null when the token is malformed, names no legal
 * destination for the piece, or is ambiguous after disambiguation is
 * applied.
 */
export function resolveSan(
	board: string[][],
	san: string,
	turn: "white" | "black",
): SanResolution | null {
	const parts = parseSan(san);
	if (!parts) return null;

	const isWhitePiece = (p: string) => p !== "." && p === p.toUpperCase();
	const isOwn = (p: string) =>
		p !== "." && turn === "white" ? isWhitePiece(p) : !isWhitePiece(p);

	// Locate candidate pieces of the requested type that can legally reach
	// the destination (all candidate squares for castling).
	const candidates: [number, number][] = [];
	for (let row = 0; row < 8; row++) {
		for (let col = 0; col < 8; col++) {
			const piece = board[row][col];
			if (!isOwn(piece)) continue;
			if (piece.toUpperCase() !== parts.piece) continue;
			if (
				parts.fromFile !== undefined &&
				squareToAlgebraic([row, col])[0] !== parts.fromFile
			)
				continue;
			if (
				parts.fromRank !== undefined &&
				squareToAlgebraic([row, col])[1] !== parts.fromRank
			)
				continue;
			candidates.push([row, col]);
		}
	}

	if (candidates.length === 0) return null;

	// Castling: the king must be on its start square (e1/e8) and every
	// square between king and destination must be empty. The shared move
	// generator models only single-step king moves, so the castle geometry
	// is validated here directly.
	if (parts.castleFile !== undefined) {
		for (const [row, col] of candidates) {
			if (col !== 4) continue; // king must be unmoved (e-file)
			const homeRank = turn === "white" ? 7 : 0;
			if (row !== homeRank) continue;
			// Squares strictly between the king (e-file) and destination
			// must be empty: f1/g1 kingside, d1/c1 queenside. For queenside
			// the rook additionally crosses b1, so that square must be
			// empty too (the rook itself sits at a1/h1, outside the path).
			const between: number[] =
				parts.castleFile === 6 ? [5, 6] : [1, 2, 3];
			if (between.every((c) => board[row][c] === ".")) {
				return { from: [row, col], to: [row, parts.castleFile] };
			}
		}
		return null;
	}

	const to = algebraicToSquare(parts.to);
	const matching = candidates.filter(([fromRow, fromCol]) => {
		// For pawn captures the origin file is part of the token, and the
		// destination must be on a different file (or a promotion push with
		// an explicit file which parseSan already captures as fromFile-less
		// pushes).
		if (parts.piece === "P" && parts.isCapture && fromCol === to[1] && parts.fromFile === undefined) {
			return false;
		}
		if (parts.fromFile !== undefined && fromCol !== parts.fromFile.charCodeAt(0) - 97) {
			return false;
		}
		if (parts.fromRank !== undefined && fromRow !== 8 - Number(parts.fromRank)) {
			return false;
		}
		// Straight pawn pushes must stay on their file; getPossibleMoves
		// already encodes that geometry, so only reachability is checked.
		return getPossibleMoves(board, [fromRow, fromCol], turn).some(
			([r, c]) => r === to[0] && c === to[1],
		);
	});

	if (matching.length !== 1) return null;
	return {
		from: matching[0],
		to,
		promotion: parts.promotion?.toLowerCase(),
	};
}
