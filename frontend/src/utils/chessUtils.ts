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
