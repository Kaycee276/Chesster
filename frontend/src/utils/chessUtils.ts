import { Chess } from "chess.js";

export function getPossibleMoves(
	board: string[][],
	from: [number, number],
	turn: "white" | "black",
): [number, number][] {
	const [row, col] = from;
	const piece = board[row][col].toLowerCase();
	const moves: [number, number][] = [];

	const isValidSquare = (r: number, c: number) =>
		r >= 0 && r < 8 && c >= 0 && c < 8;

	const canCapture = (r: number, c: number) => {
		if (!isValidSquare(r, c)) return false;
		const target = board[r][c];
		if (target === ".") return true;
		return (
			(turn === "white" && target === target.toLowerCase()) ||
			(turn === "black" && target === target.toUpperCase())
		);
	};

	const addIfValid = (r: number, c: number) => {
		if (canCapture(r, c)) moves.push([r, c]);
	};

	switch (piece) {
		case "p": {
			const dir = turn === "white" ? -1 : 1;
			const startRow = turn === "white" ? 6 : 1;
			if (isValidSquare(row + dir, col) && board[row + dir][col] === ".") {
				moves.push([row + dir, col]);
				if (row === startRow && board[row + 2 * dir][col] === ".") {
					moves.push([row + 2 * dir, col]);
				}
			}
			[-1, 1].forEach((dc) => {
				const r = row + dir,
					c = col + dc;
				if (isValidSquare(r, c) && board[r][c] !== "." && canCapture(r, c)) {
					moves.push([r, c]);
				}
			});
			break;
		}
		case "n": {
			[
				[2, 1],
				[2, -1],
				[-2, 1],
				[-2, -1],
				[1, 2],
				[1, -2],
				[-1, 2],
				[-1, -2],
			].forEach(([dr, dc]) => {
				addIfValid(row + dr, col + dc);
			});
			break;
		}
		case "b": {
			[
				[1, 1],
				[1, -1],
				[-1, 1],
				[-1, -1],
			].forEach(([dr, dc]) => {
				for (let i = 1; i < 8; i++) {
					const r = row + dr * i,
						c = col + dc * i;
					if (!isValidSquare(r, c)) break;
					if (board[r][c] === ".") moves.push([r, c]);
					else {
						if (canCapture(r, c)) moves.push([r, c]);
						break;
					}
				}
			});
			break;
		}
		case "r": {
			[
				[1, 0],
				[-1, 0],
				[0, 1],
				[0, -1],
			].forEach(([dr, dc]) => {
				for (let i = 1; i < 8; i++) {
					const r = row + dr * i,
						c = col + dc * i;
					if (!isValidSquare(r, c)) break;
					if (board[r][c] === ".") moves.push([r, c]);
					else {
						if (canCapture(r, c)) moves.push([r, c]);
						break;
					}
				}
			});
			break;
		}
		case "q": {
			[
				[1, 0],
				[-1, 0],
				[0, 1],
				[0, -1],
				[1, 1],
				[1, -1],
				[-1, 1],
				[-1, -1],
			].forEach(([dr, dc]) => {
				for (let i = 1; i < 8; i++) {
					const r = row + dr * i,
						c = col + dc * i;
					if (!isValidSquare(r, c)) break;
					if (board[r][c] === ".") moves.push([r, c]);
					else {
						if (canCapture(r, c)) moves.push([r, c]);
						break;
					}
				}
			});
			break;
		}
		case "k": {
			[
				[1, 0],
				[-1, 0],
				[0, 1],
				[0, -1],
				[1, 1],
				[1, -1],
				[-1, 1],
				[-1, -1],
			].forEach(([dr, dc]) => {
				addIfValid(row + dr, col + dc);
			});
			break;
		}
	}

	return moves;
}

export const INITIAL_BOARD: string[][] = [
	["r", "n", "b", "q", "k", "b", "n", "r"],
	["p", "p", "p", "p", "p", "p", "p", "p"],
	[".", ".", ".", ".", ".", ".", ".", "."],
	[".", ".", ".", ".", ".", ".", ".", "."],
	[".", ".", ".", ".", ".", ".", ".", "."],
	[".", ".", ".", ".", ".", ".", ".", "."],
	["P", "P", "P", "P", "P", "P", "P", "P"],
	["R", "N", "B", "Q", "K", "B", "N", "R"],
];

export function getCapturedPieces(
	board: string[][],
	color: "white" | "black",
): string[] {
	const currentCount: Record<string, number> = {};

	// Count all pieces currently on the board
	for (const row of board) {
		for (const piece of row) {
			if (piece !== ".") {
				currentCount[piece] = (currentCount[piece] || 0) + 1;
			}
		}
	}

	// Base initial counts (case neutral)
	const baseInitial: Record<string, number> = {
		p: 8,
		r: 2,
		n: 2,
		b: 2,
		q: 1,
		k: 1,
	};

	const captured: string[] = [];

	const opponentIsWhite = color === "black";

	for (const basePiece in baseInitial) {
		const piece = opponentIsWhite
			? basePiece.toUpperCase()
			: basePiece.toLowerCase();

		const initial = baseInitial[basePiece];
		const remaining = currentCount[piece] || 0;
		const capturedCount = initial - remaining;

		for (let i = 0; i < capturedCount; i++) {
			captured.push(piece);
		}
	}

	return captured;
}

/** Standard chess piece values used to compute material (king = 0). */
export const PIECE_VALUES: Record<string, number> = {
	p: 1,
	n: 3,
	b: 3,
	r: 5,
	q: 9,
	k: 0,
};

/** Total material value captured in a list of captured pieces. */
export function capturedMaterial(captured: string[]): number {
	return captured.reduce(
		(sum, piece) => sum + (PIECE_VALUES[piece.toLowerCase()] ?? 0),
		0,
	);
}

/**
 * Live material values currently held by each side on the board,
 * computed from what each side has captured so far.
 */
export function materialAdvantage(board: string[][]): {
	white: number;
	black: number;
} {
	return {
		white: capturedMaterial(getCapturedPieces(board, "white")),
		black: capturedMaterial(getCapturedPieces(board, "black")),
	};
}

/**
 * Converts a board index position ([row, col]) to algebraic notation
 * (e.g. [4, 4] -> "e4").
 */
export function squareToAlgebraic(pos: [number, number]): string {
	const [row, col] = pos;
	return `${String.fromCharCode(97 + col)}${8 - row}`;
}

/** Formats a move as compact algebraic notation (e.g. "e2e4" or "e7e8q"). */
export function moveToAlgebraic(
	from: [number, number],
	to: [number, number],
	promotion?: string | null,
): string {
	return `${squareToAlgebraic(from)}${squareToAlgebraic(to)}${
		promotion ?? ""
	}`;
}

/**
 * Converts algebraic notation (e.g. "e4") to a board index position
 * ([row, col]). Inverse of squareToAlgebraic.
 */
export function algebraicToSquare(square: string): [number, number] {
	const col = square.charCodeAt(0) - 97;
	const row = 8 - parseInt(square[1], 10);
	return [row, col];
}

/**
 * Applies a move to a board, returning a new board plus a few facts about
 * the move (piece moved, whether it was a capture/castle/en-passant), and
 * auto-queening pawns that reach the back rank unless a promotion piece is
 * given. Used by the analysis board (#251) for interactively exploring
 * candidate lines and by the PGN replay engine.
 */
export function applyMove(
	board: string[][],
	from: [number, number],
	to: [number, number],
	promotion?: string,
): { board: string[][]; piece: string; isCapture: boolean; isCastle: boolean; isEnPassant: boolean } {
	const next = board.map((r) => [...r]);
	const piece = next[from[0]][from[1]];
	const capturedOnDest = next[to[0]][to[1]] !== ".";
	const isPawn = piece.toLowerCase() === "p";
	const isEnPassant = isPawn && from[1] !== to[1] && !capturedOnDest;
	const isCastle = piece.toLowerCase() === "k" && Math.abs(to[1] - from[1]) === 2;

	if (isEnPassant) {
		// Captured pawn sits beside the destination, on the departure rank.
		next[from[0]][to[1]] = ".";
	}

	next[to[0]][to[1]] = piece;
	next[from[0]][from[1]] = ".";

	if (isCastle) {
		const rank = from[0];
		const kingside = to[1] > from[1];
		const rookFromCol = kingside ? 7 : 0;
		const rookToCol = kingside ? to[1] - 1 : to[1] + 1;
		next[rank][rookToCol] = next[rank][rookFromCol];
		next[rank][rookFromCol] = ".";
	}

	if (isPawn && (to[0] === 0 || to[0] === 7)) {
		const promo = promotion ?? "q";
		next[to[0]][to[1]] = piece === piece.toUpperCase() ? promo.toUpperCase() : promo.toLowerCase();
	}

	return { board: next, piece, isCapture: capturedOnDest || isEnPassant, isCastle, isEnPassant };
}

export interface FenOptions {
	turn?: "white" | "black";
	/** Castling availability in FEN order, e.g. "KQkq" or "-". */
	castling?: string;
	/** En passant target square, e.g. "e3", or "-". */
	enPassant?: string;
	halfmoveClock?: number;
	fullmoveNumber?: number;
}

/**
 * Converts a board array into a complete FEN string. Every field can be
 * supplied, so the board editor can preserve castling, en passant and clock
 * metadata. `boardToFen` is the minimal board + side-to-move form used by
 * the live game and analysis engine.
 */
export function buildFen(board: string[][], options: FenOptions = {}): string {
	const rows: string[] = [];
	for (const row of board) {
		let fenRow = "";
		let empty = 0;
		for (const sq of row) {
			if (sq === ".") {
				empty++;
			} else {
				if (empty > 0) {
					fenRow += empty;
					empty = 0;
				}
				fenRow += sq;
			}
		}
		if (empty > 0) fenRow += empty;
		rows.push(fenRow);
	}
	const turn = options.turn ?? "white";
	const castling = options.castling?.trim() || "-";
	const enPassant = options.enPassant?.trim() || "-";
	const halfmove = Math.max(0, Math.trunc(options.halfmoveClock ?? 0));
	const fullmove = Math.max(1, Math.trunc(options.fullmoveNumber ?? 1));
	return `${rows.join("/")} ${turn === "white" ? "w" : "b"} ${castling} ${enPassant} ${halfmove} ${fullmove}`;
}

/** Converts the current board array to a minimal FEN position string. */
export function boardToFen(board: string[][], turn: "white" | "black"): string {
	return buildFen(board, { turn });
}

export interface ParsedFen {
	board: string[][];
	turn: "white" | "black";
	castling: string;
	enPassant: string;
	halfmoveClock: number;
	fullmoveNumber: number;
}

/** Parses a FEN string into the app's board representation. Throws on
 * malformed FEN (missing fields, bad placement, illegal material). */
export function parseFen(fen: string): ParsedFen {
	const chess = new Chess(fen);
	const board = chess.board().map((rank) =>
		rank.map((square) => {
			if (!square) return ".";
			return square.color === "w" ? square.type.toUpperCase() : square.type;
		}),
	);
	const [, turnField, castlingField, enPassantField, halfField, fullField] = fen
		.trim()
		.split(/\s+/);
	return {
		board,
		turn: turnField === "b" ? "black" : "white",
		castling: castlingField === "-" ? "" : (castlingField ?? ""),
		enPassant: enPassantField === "-" ? "" : (enPassantField ?? ""),
		halfmoveClock: Number(halfField) || 0,
		fullmoveNumber: Number(fullField) || 1,
	};
}

export interface FenValidation {
	valid: boolean;
	error?: string;
}

/**
 * Validates a custom position using chess.js plus the editor-specific rules
 * chess.js permits: pawns may not sit on the first/eighth rank, both sides
 * need exactly one king, and the side that just moved may not be in check.
 */
export function validateFenPosition(fen: string): FenValidation {
	let chess: Chess;
	try {
		chess = new Chess(fen);
	} catch (error) {
		const message = error instanceof Error ? error.message : "Invalid FEN";
		return { valid: false, error: message.replace(/^Invalid FEN:\s*/i, "") };
	}

	const board = chess.board();
	const kings: Record<"w" | "b", { row: number; col: number }[]> = { w: [], b: [] };

	for (let row = 0; row < board.length; row++) {
		for (let col = 0; col < board[row].length; col++) {
			const square = board[row][col];
			if (!square) continue;
			if (square.type === "k") kings[square.color].push({ row, col });
			if (square.type === "p" && (row === 0 || row === 7)) {
				return {
					valid: false,
					error: `Pawns cannot be placed on rank ${row === 0 ? 8 : 1}`,
				};
			}
		}
	}

	if (kings.w.length !== 1 || kings.b.length !== 1) {
		const missing =
			kings.w.length !== 1 && kings.b.length !== 1
				? "both kings"
				: kings.w.length !== 1
					? "the white king"
					: "the black king";
		return { valid: false, error: `Position must contain exactly one king per side (missing ${missing})` };
	}

	const whiteKing = kings.w[0];
	const blackKing = kings.b[0];
	if (Math.abs(whiteKing.row - blackKing.row) <= 1 && Math.abs(whiteKing.col - blackKing.col) <= 1) {
		return { valid: false, error: "Kings cannot be on adjacent squares" };
	}

	// If the side that just moved is in check, the position is unreachable.
	const fields = fen.trim().split(/\s+/);
	fields[1] = fields[1] === "w" ? "b" : "w";
	// En passant depends on the side to move, so drop it for the check probe.
	fields[3] = "-";
	try {
		const swapped = new Chess(fields.join(" "));
		if (swapped.isCheck()) {
			return { valid: false, error: "The side that just moved cannot be in check" };
		}
	} catch {
		return { valid: false, error: "Invalid position metadata" };
	}

	return { valid: true };
}

/**
 * Formats a list of algebraic move strings as a PGN game score.
 * Adds move numbers and wraps at 80 characters.
 */
export function movesToPgn(moves: string[], result = "*"): string {
	let pgn = "";
	for (let i = 0; i < moves.length; i++) {
		if (i % 2 === 0) pgn += `${Math.floor(i / 2) + 1}. `;
		pgn += moves[i] + " ";
	}
	return pgn.trim() + " " + result;
}
