import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Chess, type Square } from "chess.js";
import { useStockfishEvaluation } from "../hooks/useStockfishEvaluation";
import { saveOfflineGame } from "../utils/offlineStorage";
import { soundService } from "../services/soundService";

const symbols: Record<string, string> = {
  K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙",
  k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟",
};
const names: Record<string, string> = { k: "King", q: "Queen", r: "Rook", b: "Bishop", n: "Knight", p: "Pawn" };
const control = "min-h-11 rounded-lg border border-(--border) bg-(--bg-secondary) px-3 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-(--accent-primary) disabled:opacity-50";

function fromPgn(pgn: string) {
  const chess = new Chess();
  if (pgn) chess.loadPgn(pgn);
  return chess;
}

function resultOf(chess: Chess): "1-0" | "0-1" | "1/2-1/2" | "*" {
  if (chess.isCheckmate()) return chess.turn() === "w" ? "0-1" : "1-0";
  return chess.isDraw() ? "1/2-1/2" : "*";
}

function Session({ newGame }: { newGame: () => void }) {
  const [game, setGame] = useState(() => ({
    pgn: "", fen: new Chess().fen(), announcement: "You play White. Choose a piece to begin.",
  }));
  const [selected, setSelected] = useState<Square | null>(null);
  const [focusSquare, setFocusSquare] = useState<Square>("e2");
  const [depth, setDepth] = useState(8);
  const [promotion, setPromotion] = useState("q");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedPgn, setSavedPgn] = useState<string | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const started = useState(() => new Date().toISOString())[0];
  const chess = useMemo(() => fromPgn(game.pgn), [game.pgn]);
  const botTurn = chess.turn() === "b" && !chess.isGameOver();
  const { status, evaluation } = useStockfishEvaluation(botTurn ? game.fen : null, { depth });
  const legal = new Set(selected ? chess.moves({ square: selected, verbose: true }).map((move) => move.to) : []);

  useEffect(() => {
    if (!botTurn || !evaluation?.final || evaluation.fen !== game.fen) return;
    try {
      const uci = evaluation.bestMove;
      if (!uci || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) throw new Error("The local engine returned no legal move. Start a new game to retry.");
      const next = fromPgn(game.pgn);
      const move = next.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] ?? "q" });
      const announcement = `Stockfish played ${move.san}.${next.isCheckmate() ? " Checkmate." : next.isCheck() ? " Check." : ""}`;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Commit the completed asynchronous worker result to the local game.
      setGame({ pgn: next.pgn(), fen: next.fen(), announcement });
      if (next.isCheck()) soundService.check();
      else if (move.captured) soundService.capture();
      else soundService.move();
    } catch (cause) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Surface a rejected asynchronous engine result.
      setError(cause instanceof Error ? cause.message : "The local engine could not complete its move.");
    }
  }, [botTurn, evaluation, game.fen, game.pgn]);

  function select(square: Square) {
    if (botTurn || chess.isGameOver() || status === "error" || status === "unsupported") return;
    if (selected && legal.has(square)) {
      const next = fromPgn(game.pgn);
      const move = next.move({ from: selected, to: square, promotion });
      setGame({ pgn: next.pgn(), fen: next.fen(), announcement: `You played ${move.san}.` });
      setSelected(null);
      setError("");
      setSavedPgn(null);
      if (next.isCheck()) soundService.check();
      else if (move.captured) soundService.capture();
      else soundService.move();
      return;
    }
    setSelected(chess.get(square)?.color === "w" ? square : null);
  }

  function arrow(event: React.KeyboardEvent, row: number, column: number) {
    const directions: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    const r = Math.max(0, Math.min(7, row + direction[0]));
    const c = Math.max(0, Math.min(7, column + direction[1]));
    const square = `${"abcdefgh"[c]}${8 - r}` as Square;
    setFocusSquare(square);
    grid.current?.querySelector<HTMLButtonElement>(`[data-square="${square}"]`)?.focus();
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const replay = fromPgn(game.pgn);
      const result = resultOf(replay);
      replay.setHeader("Event", "Chesster Offline Bot Game");
      replay.setHeader("White", "You");
      replay.setHeader("Black", "Stockfish");
      replay.setHeader("Result", result);
      await saveOfflineGame({ id: `offline-bot:${started}`, createdAt: started, whitePlayer: "You", blackPlayer: "Stockfish", result, pgn: replay.pgn() });
      setSavedPgn(game.pgn);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this replay. Your game is still available in this tab.");
    } finally {
      setSaving(false);
    }
  }

  const engineError = status === "error" ? "The local engine could not load. Reconnect once to cache it, then start a new game." : status === "unsupported" ? "This browser cannot run the local engine. You can still review saved replays." : "";
  const gameResult = resultOf(chess);
  const message = chess.isGameOver() ? `Game over: ${gameResult}.` : botTurn ? "Stockfish is thinking…" : game.announcement;

  return (
    <main className="min-h-dvh bg-(--bg) p-4 pb-28 text-(--text) sm:p-8">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div><h1 className="text-2xl font-bold">Offline Stockfish</h1><p className="text-sm text-(--text-secondary)">Play as White. Moves and replays stay on this device.</p></div>
          <Link to="/offline-games" className={control}>Saved replays</Link>
        </header>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm font-semibold">Bot strength <select className={`${control} ml-2`} value={depth} disabled={botTurn} onChange={(event) => setDepth(Number(event.target.value))}><option value={4}>Casual</option><option value={8}>Club</option><option value={12}>Strong</option></select></label>
          <label className="text-sm font-semibold">Promote to <select className={`${control} ml-2`} value={promotion} onChange={(event) => setPromotion(event.target.value)}><option value="q">Queen</option><option value="r">Rook</option><option value="b">Bishop</option><option value="n">Knight</option></select></label>
          <button type="button" className={control} onClick={newGame}>New game</button>
          <button type="button" className={control} disabled={!chess.history().length || saving} onClick={() => void save()}>{saving ? "Saving…" : "Save replay"}</button>
        </div>
        <p role="status" aria-live="polite" className="min-h-6 text-sm">{savedPgn === game.pgn ? "Replay saved." : status === "loading" ? "Loading local Stockfish…" : message}</p>
        {(error || engineError) && <p role="alert" className="text-sm text-red-700 [.dark_&]:text-red-400">{error || engineError}</p>}
        <div ref={grid} role="grid" aria-label="Offline chessboard" aria-rowcount={8} aria-colcount={8} className="grid grid-rows-8 aspect-square w-full max-w-xl overflow-hidden rounded-lg border border-(--border)">
          {chess.board().map((row, r) => (
            <div role="row" key={r} className="grid grid-cols-8">
              {row.map((piece, c) => {
                const square = `${"abcdefgh"[c]}${8 - r}` as Square;
                const description = piece ? `${piece.color === "w" ? "White" : "Black"} ${names[piece.type]} on ${square}` : `${square}, empty`;
                const label = `${description}${selected === square ? ", selected" : ""}${legal.has(square) ? piece ? ", legal capture" : ", legal destination" : ""}`;
                return <button type="button" role="gridcell" key={square} data-square={square} tabIndex={focusSquare === square ? 0 : -1} aria-label={label} aria-selected={selected === square} aria-disabled={botTurn || chess.isGameOver()} onFocus={() => setFocusSquare(square)} onClick={() => select(square)} onKeyDown={(event) => arrow(event, r, c)} className={`relative flex items-center justify-center text-3xl focus-visible:z-10 focus-visible:outline-4 focus-visible:-outline-offset-4 focus-visible:outline-(--accent-primary) sm:text-5xl ${(r + c) % 2 ? "bg-(--sq-dark)" : "bg-(--sq-light)"} ${selected === square ? "ring-4 ring-inset ring-(--accent-primary)" : ""}`}>
                  {piece && <span aria-hidden="true" className={piece.color === "w" ? "text-white [text-shadow:0_1px_2px_black]" : "text-black [text-shadow:0_1px_2px_white]"}>{symbols[piece.color === "w" ? piece.type.toUpperCase() : piece.type]}</span>}
                  {legal.has(square) && <span aria-hidden="true" className="absolute h-3 w-3 rounded-full bg-(--accent-primary)" />}
                </button>;
              })}
            </div>
          ))}
        </div>
        <p className="text-sm text-(--text-secondary)">Use arrow keys to move around the board, then Enter or Space to select a piece and its destination.</p>
        <p className="break-words text-sm text-(--text-secondary)">{chess.history().join(" ")}</p>
      </div>
    </main>
  );
}

export default function OfflineBotGame() {
  const [session, setSession] = useState(0);
  return <Session key={session} newGame={() => setSession((current) => current + 1)} />;
}
