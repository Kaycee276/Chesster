import { BOARD_THEMES, type BoardThemeKey } from "../store/themeStore";

/**
 * Chess piece Unicode symbols for rendering on canvas
 */
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

/**
 * Parses a FEN string into an 8x8 board array.
 * Handles the position part only (first component of FEN).
 */
function fenToBoard(fenPosition: string): string[][] {
	const board: string[][] = [];
	const rows = fenPosition.split("/");

	for (const row of rows) {
		const boardRow: string[] = [];
		for (const char of row) {
			if (char === char.toUpperCase() && !isNaN(Number(char))) {
				// It's a number representing empty squares
				for (let i = 0; i < Number(char); i++) {
					boardRow.push(".");
				}
			} else {
				// It's a piece
				boardRow.push(char);
			}
		}
		board.push(boardRow);
	}

	return board;
}

/**
 * Generates a social card image (1200x630 PNG) from a chess position.
 * Shows the board, player info, and game outcome.
 *
 * @param fen - The FEN position string (position only, not full FEN)
 * @param whiteUsername - Username of the white player
 * @param whiteRating - ELO rating of the white player
 * @param blackUsername - Username of the black player
 * @param blackRating - ELO rating of the black player
 * @param result - Game result text (e.g., "White wins by checkmate", "Draw by stalemate")
 * @param boardThemeKey - Board theme to use (default: "classic")
 * @returns Promise resolving to a PNG Blob
 */
export async function generateBoardSocialCard(
	fen: string,
	whiteUsername: string,
	whiteRating: number | string,
	blackUsername: string,
	blackRating: number | string,
	result: string,
	boardThemeKey: BoardThemeKey = "classic",
): Promise<Blob> {
	const canvas = document.createElement("canvas");
	canvas.width = 1200;
	canvas.height = 630;

	const ctx = canvas.getContext("2d");
	if (!ctx) {
		throw new Error("Failed to get canvas 2D context");
	}

	// Get theme colors
	const theme =
		BOARD_THEMES.find((t) => t.key === boardThemeKey) ?? BOARD_THEMES[0];
	const lightSquareColor = theme.light;
	const darkSquareColor = theme.dark;

	// Parse FEN into board
	const fenParts = fen.split(" ");
	const positionPart = fenParts[0];
	const board = fenToBoard(positionPart);

	// Layout dimensions
	const boardSize = 480; // 8x60px squares
	const squareSize = boardSize / 8;
	const boardStartX = 40;
	const boardStartY = 80;

	// ─── Draw background ───────────────────────────────────────────────────────
	ctx.fillStyle = "#1a1a1a";
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	// ─── Draw board ───────────────────────────────────────────────────────────
	for (let row = 0; row < 8; row++) {
		for (let col = 0; col < 8; col++) {
			const x = boardStartX + col * squareSize;
			const y = boardStartY + row * squareSize;

			// Alternate square colors (classic checkerboard pattern)
			const isLight = (row + col) % 2 === 0;
			ctx.fillStyle = isLight ? lightSquareColor : darkSquareColor;
			ctx.fillRect(x, y, squareSize, squareSize);

			// Draw piece if present
			const piece = board[row][col];
			if (piece && piece !== ".") {
				drawPieceOnCanvas(
					ctx,
					piece,
					x + squareSize / 2,
					y + squareSize / 2,
					squareSize * 0.65,
				);
			}
		}
	}

	// ─── Draw white player info (bottom-left) ──────────────────────────────────
	const leftPanelX = boardStartX;
	const bottomPanelY = boardStartY + boardSize + 20;

	ctx.fillStyle = "#ffffff";
	ctx.font = "bold 16px Arial";
	ctx.fillText(`${whiteUsername} (${whiteRating})`, leftPanelX, bottomPanelY);

	// ─── Draw black player info (top-left) ──────────────────────────────────────
	const topPanelY = boardStartY - 20;

	ctx.fillStyle = "#ffffff";
	ctx.font = "bold 16px Arial";
	ctx.fillText(`${blackUsername} (${blackRating})`, leftPanelX, topPanelY);

	// ─── Draw result banner (right side) ───────────────────────────────────────
	const resultPanelX = boardStartX + boardSize + 40;
	const resultPanelY = boardStartY + boardSize / 2 - 60;
	const resultPanelWidth = 200;
	const resultPanelHeight = 120;

	// Result banner background
	ctx.fillStyle = "rgba(255, 215, 0, 0.15)";
	ctx.fillRect(resultPanelX, resultPanelY, resultPanelWidth, resultPanelHeight);

	ctx.strokeStyle = "#ffd700";
	ctx.lineWidth = 2;
	ctx.strokeRect(resultPanelX, resultPanelY, resultPanelWidth, resultPanelHeight);

	// Result text
	ctx.fillStyle = "#ffd700";
	ctx.font = "bold 14px Arial";
	ctx.textAlign = "center";

	// Wrap text if needed
	const maxResultWidth = resultPanelWidth - 20;
	const resultLines = wrapText(ctx, result, maxResultWidth);
	let lineY = resultPanelY + 30;

	for (const line of resultLines) {
		ctx.fillText(line, resultPanelX + resultPanelWidth / 2, lineY);
		lineY += 25;
	}

	// ─── Draw Chesster logo/watermark (bottom-right) ────────────────────────────
	const watermarkX = canvas.width - 80;
	const watermarkY = canvas.height - 40;

	ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
	ctx.font = "10px Arial";
	ctx.textAlign = "right";
	ctx.fillText("Chesster", watermarkX, watermarkY);

	// ─── Draw timestamp (bottom-right) ──────────────────────────────────────────
	const timestamp = new Date().toLocaleDateString();
	ctx.fillStyle = "rgba(255, 255, 255, 0.2)";
	ctx.font = "9px Arial";
	ctx.fillText(timestamp, watermarkX, watermarkY + 15);

	// ─── Convert canvas to Blob ────────────────────────────────────────────────
	return new Promise((resolve, reject) => {
		canvas.toBlob((blob) => {
			if (blob) {
				resolve(blob);
			} else {
				reject(new Error("Failed to create blob from canvas"));
			}
		}, "image/png");
	});
}

/**
 * Draws a chess piece on the canvas at the given coordinates.
 * Uses Unicode symbols with appropriate styling.
 */
function drawPieceOnCanvas(
	ctx: CanvasRenderingContext2D,
	piece: string,
	x: number,
	y: number,
	size: number,
): void {
	const symbol = PIECE_SYMBOLS[piece];
	if (!symbol) return;

	const isWhite = piece === piece.toUpperCase();

	ctx.font = `bold ${Math.round(size)}px Arial Unicode, Arial`;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";

	// Draw piece with shadow for contrast
	if (isWhite) {
		// White piece: white text with black shadow
		ctx.fillStyle = "#000000";
		ctx.fillText(symbol, x + 1, y + 1);
		ctx.fillStyle = "#ffffff";
	} else {
		// Black piece: dark text with white shadow
		ctx.fillStyle = "#ffffff";
		ctx.fillText(symbol, x + 1, y + 1);
		ctx.fillStyle = "#000000";
	}

	ctx.fillText(symbol, x, y);
}

/**
 * Wraps text to fit within a given width on canvas.
 */
function wrapText(
	ctx: CanvasRenderingContext2D,
	text: string,
	maxWidth: number,
): string[] {
	const words = text.split(" ");
	const lines: string[] = [];
	let currentLine = "";

	for (const word of words) {
		const testLine = currentLine ? `${currentLine} ${word}` : word;
		const metrics = ctx.measureText(testLine);

		if (metrics.width > maxWidth && currentLine) {
			lines.push(currentLine);
			currentLine = word;
		} else {
			currentLine = testLine;
		}
	}

	if (currentLine) {
		lines.push(currentLine);
	}

	return lines;
}
