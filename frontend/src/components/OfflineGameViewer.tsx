import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Chess } from "chess.js";
import { ArrowLeft, Download, Upload } from "lucide-react";
import {
  exportOfflineGamesToJSON,
  exportOfflineGamesToPGN,
  getAllOfflineGames,
  importOfflineGames,
  loadOfflinePgn,
  MAX_IMPORT_BYTES,
  type OfflineGame,
} from "../utils/offlineStorage";

const buttonClass =
  "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold bg-(--bg-tertiary) hover:bg-(--bg-secondary) focus-visible:outline-2 focus-visible:outline-(--accent-primary) disabled:opacity-50 disabled:cursor-not-allowed";
const pieces: Record<string, string> = {
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

function Replay({ game }: { game: OfflineGame }) {
  const [ply, setPly] = useState(0);
  const { boards, moves } = useMemo(() => {
    const chess = loadOfflinePgn(game.pgn);
    const history = chess.history({ verbose: true });
    return {
      boards: [
        new Chess(history[0].before).board(),
        ...history.map((m) => new Chess(m.after).board()),
      ],
      moves: history.map((m) => m.san),
    };
  }, [game.pgn]);
  return (
    <section className="flex flex-col gap-4 min-w-0" aria-label="Game replay">
      <h2 className="text-lg font-semibold wrap-anywhere">
        {game.whitePlayer} vs {game.blackPlayer}
      </h2>
      <div
        className="grid grid-cols-8 w-full max-w-md aspect-square"
        role="img"
        aria-label={`Chess position after ${ply} moves`}
      >
        {boards[ply].flatMap((row, r) =>
          row.map((piece, c) => (
            <div
              key={`${r}-${c}`}
              className={`flex items-center justify-center text-3xl sm:text-4xl ${(r + c) % 2 ? "bg-(--sq-dark)" : "bg-(--sq-light)"}`}
            >
              {piece && (
                <span
                  className={
                    piece.color === "w"
                      ? "text-white [text-shadow:0_1px_2px_black]"
                      : "text-black [text-shadow:0_1px_2px_white]"
                  }
                >
                  {pieces[piece.color === "w" ? piece.type.toUpperCase() : piece.type]}
                </span>
              )}
            </div>
          ))
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button className={buttonClass} onClick={() => setPly(ply - 1)} disabled={!ply}>
          Previous move
        </button>
        <span className="text-sm tabular-nums">
          {ply} / {moves.length}
        </span>
        <button
          className={buttonClass}
          onClick={() => setPly(ply + 1)}
          disabled={ply === moves.length}
        >
          Next move
        </button>
      </div>
      <p className="text-sm text-(--text-secondary) wrap-anywhere">
        {moves.slice(0, ply).join(" ") || "Starting position"}
      </p>
    </section>
  );
}

export default function OfflineGameViewer() {
  const [games, setGames] = useState<OfflineGame[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [viewing, setViewing] = useState<OfflineGame | null>(null);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [resultFilter, setResultFilter] = useState<"all" | "1-0" | "0-1" | "1/2-1/2">("all");
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let active = true;
    getAllOfflineGames()
      .then((saved) => {
        if (active) setGames(saved);
      })
      .catch((err: unknown) => {
        if (active)
          setError(
            err instanceof Error ? err.message : "Could not load saved games. Please try again."
          );
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function exportGames(format: "pgn" | "json") {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const ids = selected.length ? selected : undefined;
      const content = await (format === "pgn"
        ? exportOfflineGamesToPGN(ids)
        : exportOfflineGamesToJSON(ids));
      const url = URL.createObjectURL(
        new Blob([content], {
          type: format === "pgn" ? "application/x-chess-pgn" : "application/json",
        })
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `chesster-offline-games.${format}`;
      document.body.appendChild(anchor);
      try {
        anchor.click();
      } finally {
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setMessage(`Exported ${selected.length || games.length} games as ${format.toUpperCase()}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function importFile(file: File) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (!/\.(pgn|json)$/i.test(file.name)) throw new Error("Choose a .pgn or .json file.");
      if (file.size > MAX_IMPORT_BYTES) throw new Error("Choose a file smaller than 10 MB.");
      const result = await importOfflineGames(await file.text());
      setGames(await getAllOfflineGames());
      setMessage(`Imported ${result.imported} games. Skipped ${result.skipped} duplicates.`);
    } catch (err) {
      setError(
        err instanceof Error
          ? `Import failed: ${err.message}`
          : "Import failed. Check the file and try again."
      );
    } finally {
      setBusy(false);
    }
  }

  const filteredGames = useMemo(() => {
    return games.filter((game) => {
      const matchesQuery = !searchQuery ||
        game.whitePlayer.toLowerCase().includes(searchQuery.toLowerCase()) ||
        game.blackPlayer.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesResult = resultFilter === 'all' || game.result === resultFilter;

      return matchesQuery && matchesResult;
    });
  }, [games, searchQuery, resultFilter]);

  return (
    <main className="min-h-dvh bg-(--bg) text-(--text) p-4 sm:p-8">
      <div className="mx-auto max-w-5xl flex flex-col gap-6">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm text-(--text-secondary) self-start"
        >
          <ArrowLeft size={16} />
          Back to lobby
        </Link>
        <header className="flex flex-col gap-3">
          <h1 className="text-2xl font-bold">Offline games</h1>
          <p className="text-sm text-(--text-secondary)">
            Back up your saved replays or import games to review them here. Select games to export a
            collection, or leave all unchecked to export everything.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link to="/offline-play" className={buttonClass}>Play offline against Stockfish</Link>
            <button
              className={buttonClass}
              disabled={busy || !games.length}
              onClick={() => void exportGames("pgn")}
            >
              <Download size={16} />
              Export PGN
            </button>
            <button
              className={buttonClass}
              disabled={busy || !games.length}
              onClick={() => void exportGames("json")}
            >
              <Download size={16} />
              Export JSON
            </button>
            <button
              className={buttonClass}
              disabled={busy}
              onClick={() => fileInput.current?.click()}
            >
              <Upload size={16} />
              Import Games
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".pgn,.json"
              aria-label="Import game file"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void importFile(file);
              }}
            />
          </div>
        </header>
        {busy && <p role="status">Loading games…</p>}
        {message && (
          <p role="status" className="text-sm">
            {message}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-700 [.dark_&]:text-red-400">
            {error}
          </p>
        )}
        {!busy && !games.length && !error && (
          <p className="py-8 text-(--text-secondary)">
            No saved games yet. Import a PGN or JSON backup to get started.
          </p>
        )}
        {!busy && games.length > 0 && (
          <div className="flex flex-col gap-4 md:flex-row">
            <input
              type="text"
              placeholder="Search by player name…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search games by player name"
              className="flex-1 px-3 py-2 rounded-lg border border-(--border) bg-(--bg) text-(--text) focus-visible:outline-2 focus-visible:outline-(--accent-primary)"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="px-3 py-2 rounded-lg bg-(--bg-tertiary) hover:bg-(--bg-secondary) text-sm font-semibold"
                aria-label="Clear search"
              >
                Clear
              </button>
            )}
            <select
              value={resultFilter}
              onChange={(e) => setResultFilter(e.target.value as "all" | "1-0" | "0-1" | "1/2-1/2")}
              aria-label="Filter by game result"
              className="px-3 py-2 rounded-lg border border-(--border) bg-(--bg) text-(--text) focus-visible:outline-2 focus-visible:outline-(--accent-primary)"
            >
              <option value="all">All Results</option>
              <option value="1-0">Wins (1-0)</option>
              <option value="0-1">Losses (0-1)</option>
              <option value="1/2-1/2">Draws (1/2-1/2)</option>
            </select>
          </div>
        )}
        <div className="grid gap-8 md:grid-cols-2">
          {filteredGames.length === 0 && !busy && games.length > 0 ? (
            <p className="py-8 text-(--text-secondary)">No games match your search.</p>
          ) : (
            <ul className="divide-y divide-(--border) min-w-0">
              {filteredGames.map((game) => (
              <li key={game.id} className="flex items-start gap-3 py-3">
                <input
                  type="checkbox"
                  className="mt-1 accent-(--accent-primary)"
                  aria-label={`Select ${game.whitePlayer} vs ${game.blackPlayer}`}
                  checked={selected.includes(game.id)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...selected, game.id]
                        : selected.filter((id) => id !== game.id)
                    )
                  }
                />
                <button
                  className="text-left flex flex-col gap-1 min-w-0 wrap-anywhere hover:text-(--accent-primary) focus-visible:outline-2 focus-visible:outline-(--accent-primary)"
                  onClick={() => setViewing(game)}
                >
                  <span className="font-semibold">
                    {game.whitePlayer} vs {game.blackPlayer}
                  </span>
                  <span className="text-sm text-(--text-secondary)">
                    {new Date(game.createdAt).toLocaleDateString()} · {game.result}
                  </span>
                </button>
              </li>
              ))}
            </ul>
          )}
          {viewing && <Replay key={viewing.id} game={viewing} />}
        </div>
      </div>
    </main>
  );
}
