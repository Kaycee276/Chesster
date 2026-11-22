const chessEngine = require("./chessEngine");

const MAX_DEPTH = 20;
const MAX_MOVE_TIME_MS = 3000;
const PIECE_PATTERN = /^[prnbqkPRNBQK.]$/;

function invalidInput(message) {
	return Object.assign(new Error(message), { code: "BOT_INVALID_INPUT" });
}

function boundedDepth(depth) {
	if (typeof depth !== "number" || !Number.isFinite(depth)) {
		throw invalidInput("depth must be a finite number");
	}
	return Math.max(1, Math.min(MAX_DEPTH, Math.floor(depth)));
}

function moveOptions(options, defaultDepth) {
	if (!options || typeof options !== "object" || Array.isArray(options)) {
		throw invalidInput("Bot search options must be an object");
	}
	const depth = options.depth === undefined ? boundedDepth(defaultDepth) : boundedDepth(options.depth);
	if (options.timeLimitMs === undefined) return { depth };
	if (!Number.isSafeInteger(options.timeLimitMs) || options.timeLimitMs < 1) {
		throw invalidInput("timeLimitMs must be a positive safe integer");
	}
	return { depth, timeLimitMs: Math.min(MAX_MOVE_TIME_MS, options.timeLimitMs) };
}

function validateBoard(board) {
	if (!Array.isArray(board) || board.length !== 8 || Array.from(board).some((row) =>
		!Array.isArray(row) || row.length !== 8 || Array.from(row).some((piece) =>
			typeof piece !== "string" || !PIECE_PATTERN.test(piece)))) {
		throw invalidInput("Invalid board: expected an 8 by 8 array of chess pieces");
	}
	const kings = board.flat();
	if (kings.filter((piece) => piece === "K").length !== 1 ||
		kings.filter((piece) => piece === "k").length !== 1) {
		throw invalidInput("Invalid board: exactly one king of each color is required");
	}
	if ([...board[0], ...board[7]].some((piece) => piece.toLowerCase() === "p")) {
		throw invalidInput("Invalid board: pawns cannot occupy the first or eighth rank");
	}
	const kingSquares = ["K", "k"].map((king) => {
		const index = kings.indexOf(king);
		return [Math.floor(index / 8), index % 8];
	});
	if (Math.abs(kingSquares[0][0] - kingSquares[1][0]) <= 1 &&
		Math.abs(kingSquares[0][1] - kingSquares[1][1]) <= 1) {
		throw invalidInput("Invalid board: kings cannot occupy adjacent squares");
	}
}

function validateHistory(turn, lastMove, moveCount) {
	if (turn !== "white" && turn !== "black") throw invalidInput("turn must be white or black");
	if (!Number.isSafeInteger(moveCount) || moveCount < 0) {
		throw invalidInput("moveCount must be a non-negative safe integer");
	}
	if (lastMove === null) return;
	const coordinates = (value) => Array.isArray(value) && value.length === 2 &&
		value.every((coordinate) => Number.isInteger(coordinate) && coordinate >= 0 && coordinate < 8);
	if (!lastMove || typeof lastMove !== "object" || !coordinates(lastMove.from) ||
		!coordinates(lastMove.to) || typeof lastMove.piece !== "string" ||
		!/^[prnbqkPRNBQK]$/.test(lastMove.piece)) {
		throw invalidInput("Invalid lastMove: expected board coordinates and a chess piece");
	}
}

/** Parse and normalize FEN before it can enter a UCI command or worker queue. */
function parseBotFen(fen) {
	if (!chessEngine.isValidFenStructure(fen)) throw invalidInput("Invalid FEN structure");
	const parts = fen.trim().split(/\s+/);
	const [, active, castling, enPassant, , fullmove] = parts;
	if (Number(fullmove) < 1 || (castling !== "-" && new Set(castling).size !== castling.length)) {
		throw invalidInput("Invalid FEN counters or castling rights");
	}
	const { board } = chessEngine.fenToBoard(fen);
	try {
		validateBoard(board);
	} catch (error) {
		throw invalidInput("Invalid FEN position: " + error.message);
	}
	const turn = active === "w" ? "white" : "black";
	const moveCount = (Number(fullmove) - 1) * 2 + (turn === "black" ? 1 : 0);
	const lastMove = enPassantMove(enPassant, turn, board);
	return { fen: parts.join(" "), board, turn, moveCount, lastMove };
}

function enPassantMove(target, turn, board) {
	if (target === "-") return null;
	const expectedRank = turn === "white" ? "6" : "3";
	const file = target.charCodeAt(0) - 97;
	const pawnRow = turn === "white" ? 3 : 4;
	const piece = turn === "white" ? "p" : "P";
	if (target[1] !== expectedRank || board[pawnRow][file] !== piece ||
		board[8 - Number(target[1])][file] !== ".") {
		throw invalidInput("Invalid FEN en passant target");
	}
	return { from: [turn === "white" ? 1 : 6, file], to: [pawnRow, file], piece };
}

module.exports = { boundedDepth, moveOptions, validateBoard, validateHistory, parseBotFen, MAX_MOVE_TIME_MS };
