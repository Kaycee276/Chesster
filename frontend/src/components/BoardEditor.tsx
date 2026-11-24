import { useEffect, useMemo, useState } from "react";
import { Eraser, RotateCcw, Trash2, X } from "lucide-react";
import {
  buildFen,
  parseFen,
  validateFenPosition,
  type ParsedFen,
} from "../utils/chessUtils";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

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

const PIECE_NAMES: Record<string, string> = {
  K: "white king",
  Q: "white queen",
  R: "white rook",
  B: "white bishop",
  N: "white knight",
  P: "white pawn",
  k: "black king",
  q: "black queen",
  r: "black rook",
  b: "black bishop",
  n: "black knight",
  p: "black pawn",
};

const WHITE_PIECES = ["K", "Q", "R", "B", "N", "P"];
const BLACK_PIECES = ["k", "q", "r", "b", "n", "p"];

interface CastlingRights {
  K: boolean;
  Q: boolean;
  k: boolean;
  q: boolean;
}

const NO_CASTLING: CastlingRights = { K: false, Q: false, k: false, q: false };

export interface BoardEditorProps {
  /** Position to start editing from. Defaults to the standard start. */
  initialFen?: string;
  onApply: (fen: string) => void;
  onClose: () => void;
}

function parseInitial(initialFen?: string): ParsedFen {
  try {
    return parseFen(initialFen ?? START_FEN);
  } catch {
    return parseFen(START_FEN);
  }
}

function castlingFromString(castling: string): CastlingRights {
  return {
    K: castling.includes("K"),
    Q: castling.includes("Q"),
    k: castling.includes("k"),
    q: castling.includes("q"),
  };
}

function castlingToString(rights: CastlingRights): string {
  return `${rights.K ? "K" : ""}${rights.Q ? "Q" : ""}${rights.k ? "k" : ""}${rights.q ? "q" : ""}`;
}

function squareName(row: number, col: number): string {
  return `${String.fromCharCode(97 + col)}${8 - row}`;
}

function emptyBoard(): string[][] {
  return Array.from({ length: 8 }, () => Array(8).fill("."));
}

/**
 * Interactive board setup editor (#757).
 *
 * Players pick pieces from the palette (click-to-place or drag-and-drop),
 * drag pieces around the board, remove them with the eraser or trash zone,
 * and configure turn / castling / en passant / halfmove metadata. The
 * generated FEN is validated before it can be loaded into analysis.
 */
export function BoardEditor({ initialFen, onApply, onClose }: BoardEditorProps) {
  const parsedInitial = useMemo(() => parseInitial(initialFen), [initialFen]);
  const [board, setBoard] = useState<string[][]>(() =>
    parsedInitial.board.map((row) => [...row]),
  );
  const [turn, setTurn] = useState<"white" | "black">(parsedInitial.turn);
  const [castling, setCastling] = useState<CastlingRights>(() =>
    castlingFromString(parsedInitial.castling),
  );
  const [enPassant, setEnPassant] = useState(parsedInitial.enPassant);
  const [halfmoveClock, setHalfmoveClock] = useState(parsedInitial.halfmoveClock);
  const [selectedPiece, setSelectedPiece] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const fen = useMemo(
    () =>
      buildFen(board, {
        turn,
        castling: castlingToString(castling),
        enPassant,
        halfmoveClock,
      }),
    [board, turn, castling, enPassant, halfmoveClock],
  );

  const validation = useMemo(() => validateFenPosition(fen), [fen]);

  const setSquare = (row: number, col: number, piece: string) => {
    setBoard((prev) => {
      const next = prev.map((rank) => [...rank]);
      next[row][col] = piece;
      return next;
    });
  };

  const movePiece = (from: [number, number], to: [number, number]) => {
    if (from[0] === to[0] && from[1] === to[1]) return;
    setBoard((prev) => {
      const next = prev.map((rank) => [...rank]);
      next[to[0]][to[1]] = next[from[0]][from[1]];
      next[from[0]][from[1]] = ".";
      return next;
    });
  };

  const handleSquareClick = (row: number, col: number) => {
    if (!selectedPiece) return;
    setSquare(row, col, selectedPiece);
  };

  const handleSquareDrop = (
    event: React.DragEvent<HTMLDivElement>,
    row: number,
    col: number,
  ) => {
    event.preventDefault();
    const payload = event.dataTransfer.getData("text/plain");
    if (payload.startsWith("palette:")) {
      setSquare(row, col, payload.slice("palette:".length));
    } else if (payload.startsWith("square:")) {
      const [, fromRow, fromCol] = payload.split(":").map(Number);
      movePiece([fromRow, fromCol], [row, col]);
    } else if (selectedPiece) {
      setSquare(row, col, selectedPiece);
    }
  };

  const handlePaletteDragStart = (
    event: React.DragEvent<HTMLButtonElement>,
    piece: string,
  ) => {
    event.dataTransfer.setData("text/plain", `palette:${piece}`);
    event.dataTransfer.effectAllowed = "copy";
    setSelectedPiece(piece);
  };

  const handleSquareDragStart = (
    event: React.DragEvent<HTMLDivElement>,
    row: number,
    col: number,
  ) => {
    if (board[row][col] === ".") {
      event.preventDefault();
      return;
    }
    event.dataTransfer.setData("text/plain", `square:${row}:${col}`);
  };

  const handleTrashDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const payload = event.dataTransfer.getData("text/plain");
    if (!payload.startsWith("square:")) return;
    const [, row, col] = payload.split(":").map(Number);
    setSquare(row, col, ".");
  };

  const handleClear = () => {
    setBoard(emptyBoard());
    setTurn("white");
    setCastling(NO_CASTLING);
    setEnPassant("");
    setHalfmoveClock(0);
    setSelectedPiece(null);
  };

  const handleReset = () => {
    const start = parseFen(START_FEN);
    setBoard(start.board.map((row) => [...row]));
    setTurn(start.turn);
    setCastling(castlingFromString(start.castling));
    setEnPassant(start.enPassant);
    setHalfmoveClock(start.halfmoveClock);
    setSelectedPiece(null);
  };

  const toggleCastling = (right: keyof CastlingRights) => {
    setCastling((prev) => ({ ...prev, [right]: !prev[right] }));
  };

  const renderPalette = (pieces: string[]) => (
    <div className="flex flex-wrap gap-1.5">
      {pieces.map((piece) => (
        <button
          key={piece}
          type="button"
          data-testid={`editor-piece-${piece}`}
          draggable
          onDragStart={(event) => handlePaletteDragStart(event, piece)}
          onClick={() => setSelectedPiece(piece)}
          aria-label={`Place ${PIECE_NAMES[piece]}`}
          aria-pressed={selectedPiece === piece}
          title={`Place ${PIECE_NAMES[piece]}`}
          className={`flex h-9 w-9 items-center justify-center rounded-lg border text-2xl leading-none transition-colors ${
            selectedPiece === piece
              ? "border-(--accent-primary) bg-(--accent-primary)/20"
              : "border-(--border) bg-(--bg) hover:border-(--accent-primary)/60"
          }`}
        >
          <span className={piece === piece.toUpperCase() ? "text-white" : "text-neutral-900"}>
            {PIECE_SYMBOLS[piece]}
          </span>
        </button>
      ))}
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="board-editor-title"
        className="max-h-[95vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-(--border) bg-(--bg-secondary) p-4 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="board-editor-title" className="text-lg font-bold">
            Board Editor
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close board editor"
            className="rounded-lg p-1.5 text-(--text-tertiary) hover:bg-(--bg) hover:text-(--text)"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col gap-4 md:flex-row">
          {/* Piece palette */}
          <div className="flex shrink-0 flex-col gap-3 md:w-40">
            <div>
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-(--text-tertiary)">
                White
              </p>
              {renderPalette(WHITE_PIECES)}
            </div>
            <div>
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-(--text-tertiary)">
                Black
              </p>
              {renderPalette(BLACK_PIECES)}
            </div>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => setSelectedPiece(".")}
                aria-label="Eraser"
                aria-pressed={selectedPiece === "."}
                title="Eraser — click a square to remove its piece"
                className={`flex flex-1 items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-xs font-semibold transition-colors ${
                  selectedPiece === "."
                    ? "border-(--accent-primary) bg-(--accent-primary)/20"
                    : "border-(--border) bg-(--bg) hover:border-(--accent-primary)/60"
                }`}
              >
                <Eraser size={13} /> Erase
              </button>
            </div>
            <div
              data-testid="editor-trash"
              onDragOver={(event) => event.preventDefault()}
              onDrop={handleTrashDrop}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-red-500/40 bg-red-500/5 px-2 py-3 text-[11px] font-semibold text-red-400"
            >
              <Trash2 size={13} /> Drag here to remove
            </div>
            <p className="text-[10px] leading-relaxed text-(--text-tertiary)">
              Click a piece, then a square. Drag pieces to move them, or drag
              them to the trash. Right-click a square to clear it.
            </p>
          </div>

          {/* Board */}
          <div className="mx-auto w-full max-w-[min(80vw,420px)] shrink-0">
            <div
              data-testid="board-editor-grid"
              className="grid aspect-square w-full grid-cols-8 grid-rows-8 overflow-hidden rounded-lg border border-(--border)"
            >
              {board.map((rank, row) =>
                rank.map((piece, col) => {
                  const isLight = (row + col) % 2 === 0;
                  return (
                    <div
                      key={`${row}-${col}`}
                      data-testid={`editor-square-${row}-${col}`}
                      role="gridcell"
                      tabIndex={0}
                      aria-label={`${squareName(row, col)} ${
                        piece === "." ? "empty" : PIECE_NAMES[piece]
                      }`}
                      onClick={() => handleSquareClick(row, col)}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        setSquare(row, col, ".");
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          handleSquareClick(row, col);
                        }
                      }}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => handleSquareDrop(event, row, col)}
                      draggable={piece !== "."}
                      onDragStart={(event) => handleSquareDragStart(event, row, col)}
                      className={`relative flex cursor-pointer items-center justify-center text-[min(7vw,2.2rem)] leading-none ${
                        isLight ? "bg-(--sq-light)" : "bg-(--sq-dark)"
                      }`}
                    >
                      {piece !== "." && (
                        <span
                          className={
                            piece === piece.toUpperCase()
                              ? "board-piece-white text-white"
                              : "board-piece-black text-neutral-900"
                          }
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

          {/* Position metadata */}
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div>
              <label
                htmlFor="editor-turn"
                className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-(--text-tertiary)"
              >
                Side to move
              </label>
              <select
                id="editor-turn"
                value={turn}
                onChange={(event) => setTurn(event.target.value as "white" | "black")}
                className="w-full rounded-lg border border-(--border) bg-(--bg) px-2 py-1.5 text-xs focus:border-(--accent-primary)/60 focus:outline-none"
              >
                <option value="white">White</option>
                <option value="black">Black</option>
              </select>
            </div>

            <fieldset>
              <legend className="mb-1 text-[10px] font-bold uppercase tracking-wider text-(--text-tertiary)">
                Castling rights
              </legend>
              <div className="grid grid-cols-2 gap-1.5">
                {(
                  [
                    ["K", "White O-O"],
                    ["Q", "White O-O-O"],
                    ["k", "Black O-O"],
                    ["q", "Black O-O-O"],
                  ] as const
                ).map(([right, label]) => (
                  <label
                    key={right}
                    className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-(--border) bg-(--bg) px-2 py-1.5 text-[11px]"
                  >
                    <input
                      type="checkbox"
                      checked={castling[right]}
                      onChange={() => toggleCastling(right)}
                      aria-label={label}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label
                  htmlFor="editor-en-passant"
                  className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-(--text-tertiary)"
                >
                  En passant
                </label>
                <input
                  id="editor-en-passant"
                  value={enPassant}
                  onChange={(event) =>
                    setEnPassant(event.target.value.replace(/[^a-h1-8]/g, "").slice(0, 2))
                  }
                  placeholder="e3"
                  aria-label="En passant target square"
                  className="w-full rounded-lg border border-(--border) bg-(--bg) px-2 py-1.5 text-xs focus:border-(--accent-primary)/60 focus:outline-none"
                />
              </div>
              <div>
                <label
                  htmlFor="editor-halfmove"
                  className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-(--text-tertiary)"
                >
                  Halfmove clock
                </label>
                <input
                  id="editor-halfmove"
                  type="number"
                  min={0}
                  value={halfmoveClock}
                  onChange={(event) =>
                    setHalfmoveClock(Math.max(0, Number(event.target.value) || 0))
                  }
                  aria-label="Halfmove clock"
                  className="w-full rounded-lg border border-(--border) bg-(--bg) px-2 py-1.5 text-xs focus:border-(--accent-primary)/60 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="editor-fen"
                className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-(--text-tertiary)"
              >
                FEN
              </label>
              <input
                id="editor-fen"
                readOnly
                value={fen}
                aria-label="FEN position"
                className="w-full rounded-lg border border-(--border) bg-(--bg) px-2 py-1.5 font-mono text-[10px] text-(--text-secondary) focus:outline-none"
              />
            </div>

            {validation.valid ? (
              <p className="text-[11px] font-semibold text-green-500">Position is valid</p>
            ) : (
              <p role="alert" className="text-[11px] font-semibold text-red-400">
                {validation.error}
              </p>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-(--border) pt-3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleClear}
              className="rounded-lg border border-(--border) bg-(--bg) px-3 py-1.5 text-xs font-semibold hover:border-(--accent-primary)/60"
            >
              Clear Board
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="flex items-center gap-1 rounded-lg border border-(--border) bg-(--bg) px-3 py-1.5 text-xs font-semibold hover:border-(--accent-primary)/60"
            >
              <RotateCcw size={12} /> Reset
            </button>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-(--border) bg-(--bg) px-3 py-1.5 text-xs font-semibold hover:border-(--accent-primary)/60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onApply(fen)}
              disabled={!validation.valid}
              className="rounded-lg bg-(--accent-dark) px-4 py-1.5 text-xs font-bold text-white transition-colors hover:bg-(--accent-primary) disabled:cursor-not-allowed disabled:opacity-40"
            >
              Apply Position
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default BoardEditor;
