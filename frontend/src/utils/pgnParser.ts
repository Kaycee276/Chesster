/**
 * pgnParser.ts
 *
 * Parses a standard PGN (Portable Game Notation) string into its header
 * tags plus a flat list of SAN move tokens, then replays those moves on a
 * board one ply at a time to reconstruct the board position after every
 * move — everything the Analysis board (#251) needs to step through an
 * imported game.
 *
 * This purposefully doesn't implement full chess legality (no
 * check/checkmate/stalemate detection of its own — it trusts the "+"/"#"
 * suffixes already present in well-formed PGN move text) and picks among
 * ambiguous SAN candidates using a simple "doesn't leave your own king in
 * check" filter rather than full move generation. That's enough to
 * correctly replay the PGN files real chess sites export.
 */

import { INITIAL_BOARD, getPossibleMoves, squareToAlgebraic, algebraicToSquare, applyMove } from "./chessUtils";

export interface ReplayedMove {
	moveNumber: number;
	color: "white" | "black";
	san: string;
	from: [number, number];
	to: [number, number];
	piece: string;
	isCapture: boolean;
	isCheck: boolean;
	isCheckmate: boolean;
	boardAfter: string[][];
}

export class PgnParseError extends Error {
	moveIndex: number;
	token: string;
	constructor(message: string, moveIndex: number, token: string) {
		super(message);
		this.name = "PgnParseError";
		this.moveIndex = moveIndex;
		this.token = token;
	}
}

const RESULT_TOKENS = new Set(["1-0", "0-1", "1/2-1/2", "*"]);

/** Strips {comments}, (variations) and $NAGs out of PGN move text. */
function stripPgnNoise(movetext: string): string {
	let s = movetext.replace(/\{[^}]*\}/g, " ");
	let prev: string;
	do {
		prev = s;
		s = s.replace(/\([^()]*\)/g, " ");
	} while (s !== prev);
	s = s.replace(/\$\d+/g, " ");
	return s;
}

/** Parses `[Tag "Value"]` header lines and the flat list of SAN move tokens. */
export function parsePgn(pgnText: string): {
	headers: Record<string, string>;
	sanMoves: string[];
	result: string;
} {
	const headers: Record<string, string> = {};
	const headerRegex = /^\s*\[(\w+)\s+"([^"]*)"\]\s*$/gm;
	let match: RegExpExecArray | null;
	while ((match = headerRegex.exec(pgnText))) {
		headers[match[1]] = match[2];
	}

	const movetext = pgnText.replace(/\[[^\]]*\]/g, " ");
	const cleaned = stripPgnNoise(movetext);
	const rawTokens = cleaned.split(/\s+/).filter(Boolean);

	const sanMoves: string[] = [];
	let result = "*";
	for (const tok of rawTokens) {
		if (RESULT_TOKENS.has(tok)) {
			result = tok;
			continue;
		}
		const stripped = tok.replace(/^\d+\.+/, "");
		if (!stripped) continue;
		sanMoves.push(stripped);
	}

	return { headers, sanMoves, result };
}

interface ParsedSan {
	piece: string; // K Q R B N P
	fromFile?: string;
	fromRank?: string;
	capture: boolean;
	to: string;
	promotion?: string;
	check: boolean;
	checkmate: boolean;
	castle?: "K" | "Q";
}

const SAN_RE = /^([KQRBN])?([a-h])?([1-8])?(x)?([a-h][1-8])(=([QRBN]))?([+#])?$/;

function parseSan(rawToken: string): ParsedSan | null {
	const san = rawToken.replace(/[!?]+$/g, "");

	if (/^(O-O-O|0-0-0)[+#]?$/.test(san)) {
		return { piece: "K", capture: false, to: "", check: /[+#]$/.test(san), checkmate: /#$/.test(san), castle: "Q" };
	}
	if (/^(O-O|0-0)[+#]?$/.test(san)) {
		return { piece: "K", capture: false, to: "", check: /[+#]$/.test(san), checkmate: /#$/.test(san), castle: "K" };
	}

	const m = san.match(SAN_RE);
	if (!m) return null;
	const [, pieceLetter, file, rank, capture, to, , promo, checkMark] = m;
	return {
		piece: pieceLetter ?? "P",
		fromFile: file,
		fromRank: rank,
		capture: !!capture,
		to,
		promotion: promo,
		check: checkMark === "+" || checkMark === "#",
		checkmate: checkMark === "#",
	};
}

function findKing(board: string[][], color: "white" | "black"): [number, number] | null {
	const target = color === "white" ? "K" : "k";
	for (let r = 0; r < 8; r++) {
		for (let c = 0; c < 8; c++) {
			if (board[r][c] === target) return [r, c];
		}
	}
	return null;
}

function isSquareAttacked(board: string[][], square: [number, number], byColor: "white" | "black"): boolean {
	for (let r = 0; r < 8; r++) {
		for (let c = 0; c < 8; c++) {
			const p = board[r][c];
			if (p === ".") continue;
			const isByColorPiece = byColor === "white" ? p === p.toUpperCase() : p === p.toLowerCase();
			if (!isByColorPiece) continue;
			const moves = getPossibleMoves(board, [r, c], byColor);
			if (moves.some(([mr, mc]) => mr === square[0] && mc === square[1])) return true;
		}
	}
	return false;
}

function leavesOwnKingInCheck(
	board: string[][],
	turn: "white" | "black",
	from: [number, number],
	to: [number, number],
): boolean {
	const test = board.map((r) => [...r]);
	test[to[0]][to[1]] = test[from[0]][from[1]];
	test[from[0]][from[1]] = ".";
	const king = findKing(test, turn);
	if (!king) return false;
	return isSquareAttacked(test, king, turn === "white" ? "black" : "white");
}

function findCandidates(
	board: string[][],
	turn: "white" | "black",
	parsed: ParsedSan,
	to: [number, number],
): [number, number][] {
	const targetChar = turn === "white" ? parsed.piece.toUpperCase() : parsed.piece.toLowerCase();
	const candidates: [number, number][] = [];
	for (let r = 0; r < 8; r++) {
		for (let c = 0; c < 8; c++) {
			if (board[r][c] !== targetChar) continue;
			const alg = squareToAlgebraic([r, c]);
			if (parsed.fromFile && alg[0] !== parsed.fromFile) continue;
			if (parsed.fromRank && alg[1] !== parsed.fromRank) continue;
			const moves = getPossibleMoves(board, [r, c], turn);
			if (moves.some(([mr, mc]) => mr === to[0] && mc === to[1])) candidates.push([r, c]);
		}
	}
	return candidates;
}

/** Replays a flat list of SAN move tokens from the starting position. */
export function replayPgn(sanMoves: string[]): ReplayedMove[] {
	let board = INITIAL_BOARD.map((r) => [...r]);
	const moves: ReplayedMove[] = [];
	let turn: "white" | "black" = "white";

	sanMoves.forEach((token, i) => {
		const parsed = parseSan(token);
		if (!parsed) {
			throw new PgnParseError(`Unrecognized move "${token}" (ply ${i + 1})`, i, token);
		}

		let from: [number, number];
		let to: [number, number];
		let piece: string;
		let isCapture: boolean;

		if (parsed.castle) {
			const rank = turn === "white" ? 7 : 0;
			const kingFrom: [number, number] = [rank, 4];
			const kingTo: [number, number] = [rank, parsed.castle === "K" ? 6 : 2];
			if (board[kingFrom[0]][kingFrom[1]].toLowerCase() !== "k") {
				throw new PgnParseError(`No king to castle for "${token}" (ply ${i + 1})`, i, token);
			}
			const applied = applyMove(board, kingFrom, kingTo);
			board = applied.board;
			from = kingFrom;
			to = kingTo;
			piece = applied.piece;
			isCapture = false;
		} else {
			to = algebraicToSquare(parsed.to);
			const candidates = findCandidates(board, turn, parsed, to);
			if (candidates.length === 0) {
				throw new PgnParseError(`No legal move matches "${token}" (ply ${i + 1})`, i, token);
			}
			const safe = candidates.length > 1 ? candidates.filter((f) => !leavesOwnKingInCheck(board, turn, f, to)) : candidates;
			from = safe[0] ?? candidates[0];
			const applied = applyMove(board, from, to, parsed.promotion?.toLowerCase());
			board = applied.board;
			piece = applied.piece;
			isCapture = parsed.capture || applied.isCapture;
		}

		moves.push({
			moveNumber: Math.floor(i / 2) + 1,
			color: turn,
			san: token,
			from,
			to,
			piece,
			isCapture,
			isCheck: parsed.check,
			isCheckmate: parsed.checkmate,
			boardAfter: board.map((r) => [...r]),
		});

		turn = turn === "white" ? "black" : "white";
	});

	return moves;
}

/** Convenience wrapper: parse + replay a full PGN string in one call. */
export function loadPgn(pgnText: string): {
	headers: Record<string, string>;
	result: string;
	moves: ReplayedMove[];
} {
	const { headers, sanMoves, result } = parsePgn(pgnText);
	if (sanMoves.length === 0) {
		throw new PgnParseError("No moves found in PGN text", 0, "");
	}
	const moves = replayPgn(sanMoves);
	return { headers, result, moves };
}
