import { Chess } from "chess.js";
import { z } from "zod";
import { parsePgn, splitPgnGames } from "./pgnParser";

const resultSchema = z.enum(["1-0", "0-1", "1/2-1/2", "*"]);
const gameSchema = z.object({
  id: z.string().min(1).max(200),
  createdAt: z.string().datetime({ offset: true }),
  whitePlayer: z.string().min(1).max(200),
  blackPlayer: z.string().min(1).max(200),
  result: resultSchema,
  pgn: z.string().min(1).max(1_000_000),
});
const archiveSchema = z.object({
  version: z.literal(1),
  games: z.array(gameSchema).max(10_000),
});
export type OfflineGame = z.infer<typeof gameSchema>;
export const OFFLINE_DB_NAME = "chesster-offline";
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const STORE = "games";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("This browser does not support offline game storage."));
      return;
    }
    const request = indexedDB.open(OFFLINE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Close other Chesster tabs and try again."));
  });
}

export async function getAllOfflineGames(): Promise<OfflineGame[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).getAll();
    tx.oncomplete = () => {
      db.close();
      resolve(
        (request.result as OfflineGame[]).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      );
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  });
}

/** chess.js does not parse PGN escaped tag values; decode them independently. */
export function loadOfflinePgn(pgn: string): Chess {
  const { headers } = parsePgn(pgn);
  const decoded = Object.fromEntries(
    Object.entries(headers).map(([tag, value]) => [tag, value.replace(/\\(["\\])/g, "$1")])
  );
  const safe = pgn.replace(
    /^\s*\[(\w+)\s+"((?:\\.|[^"])*)"\]\s*$/gm,
    (_line, tag: string) => `[${tag} "${decoded[tag].replace(/["\\]/g, "'")}"]`
  );
  const chess = new Chess();
  chess.loadPgn(safe);
  if (decoded.Result && decoded.Result !== chess.getHeaders().Result) {
    throw new Error("The PGN header result does not match its move text result.");
  }
  for (const [tag, value] of Object.entries(decoded)) chess.setHeader(tag, value);
  return chess;
}

function validatedGame(value: unknown): OfflineGame {
  const game = gameSchema.parse(value);
  const chess = loadOfflinePgn(game.pgn);
  if (!chess.history().length) throw new Error("A replay must contain at least one move.");
  if (chess.getHeaders().Result && chess.getHeaders().Result !== game.result) {
    throw new Error("The replay result does not match its PGN result.");
  }
  return { ...game, createdAt: new Date(game.createdAt).toISOString() };
}

/** Timestamp and canonical move digest identify a replay across browsers and formats. */
async function replayKey(game: OfflineGame): Promise<string> {
  const chess = loadOfflinePgn(game.pgn);
  const moves = chess.history({ verbose: true });
  const canonical = JSON.stringify([moves[0].before, moves.map((m) => m.lan)]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return `${new Date(game.createdAt).toISOString()}:${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

async function insertGames(games: OfflineGame[]): Promise<{ imported: number; skipped: number }> {
  // Hash before opening the write transaction: async work would otherwise let it close.
  const incoming = await Promise.all(
    games.map(async (game) => ({ game, key: await replayKey(game) }))
  );
  const existing = await getAllOfflineGames();
  const existingKeys = new Map(
    await Promise.all(existing.map(async (g) => [g.id, await replayKey(g)] as const))
  );
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    let imported = 0;
    let skipped = 0;
    // Read again under the write lock so simultaneous imports cannot overwrite each other.
    const request = store.getAll();
    request.onsuccess = () => {
      const current = request.result as OfflineGame[];
      const keys = new Set(current.map((g) => existingKeys.get(g.id) ?? g.id));
      const ids = new Set(current.map((g) => g.id));
      for (const { game, key } of incoming) {
        // New records use the digest as their ID, making concurrent duplicate imports safe.
        if (keys.has(key) || ids.has(key)) {
          skipped++;
          continue;
        }
        store.add({ ...game, id: key });
        keys.add(key);
        ids.add(key);
        imported++;
      }
    };
    tx.oncomplete = () => {
      db.close();
      resolve({ imported, skipped });
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error("Import failed. No games were saved."));
    };
  });
}

export async function saveOfflineGame(game: OfflineGame): Promise<void> {
  await insertGames([validatedGame(game)]);
}

async function selectedGames(ids?: readonly string[]): Promise<OfflineGame[]> {
  const games = await getAllOfflineGames();
  return ids ? games.filter((g) => ids.includes(g.id)) : games;
}

export async function exportOfflineGamesToJSON(ids?: readonly string[]): Promise<string> {
  return JSON.stringify({ version: 1, games: await selectedGames(ids) }, null, 2);
}

export async function exportOfflineGamesToPGN(ids?: readonly string[]): Promise<string> {
  const games = await selectedGames(ids);
  return (
    games
      .map((game) => {
        const chess = loadOfflinePgn(game.pgn);
        // Preserve FEN, annotations and other source headers while supplying standard metadata.
        chess.setHeader("Event", "Chesster Offline Game");
        chess.setHeader("Site", "Chesster");
        chess.setHeader("Date", game.createdAt.slice(0, 10).replaceAll("-", "."));
        chess.setHeader("Round", chess.getHeaders().Round || "?");
        chess.setHeader("White", game.whitePlayer);
        chess.setHeader("Black", game.blackPlayer);
        chess.setHeader("Result", game.result);
        chess.setHeader("ChessterCreatedAt", game.createdAt);
        const text = chess.pgn({ maxWidth: 80 });
        const escapeTag = (value: string) =>
          value
            .replace(/\\/g, "\\\\")
            .replace(/"/g, '\\"')
            .replace(/[\r\n]/g, " ");
        const headers = Object.entries(chess.getHeaders())
          .map(([tag, value]) => `[${tag} "${escapeTag(value)}"]`)
          .join("\n");
        return `${headers}\n\n${text.slice(text.indexOf("\n\n") + 2)}`;
      })
      .join("\n\n") + (games.length ? "\n" : "")
  );
}

/** Validate the entire archive before starting an atomic IndexedDB write. */
export async function importOfflineGames(
  fileContent: string
): Promise<{ imported: number; skipped: number }> {
  if (new Blob([fileContent]).size > MAX_IMPORT_BYTES)
    throw new Error("Choose a file smaller than 10 MB.");
  const content = fileContent.replace(/^\uFEFF/, "").trim();
  if (!content) throw new Error("The selected file is empty.");
  let games: OfflineGame[];
  if (/^[{[]/.test(content)) {
    // A PGN also starts with '['; only parse JSON when it looks like an array or object.
    if (content.startsWith("{") || /^\[\s*(?:\{|\]|"|\d)/.test(content)) {
      const parsed: unknown = JSON.parse(content);
      const values = Array.isArray(parsed)
        ? z.array(gameSchema).max(10_000).parse(parsed)
        : archiveSchema.parse(parsed).games;
      games = values.map(validatedGame);
    } else {
      games = parsePgnArchive(content);
    }
  } else {
    games = parsePgnArchive(content);
  }
  return insertGames(games);
}

function parsePgnArchive(content: string): OfflineGame[] {
  const segments = splitPgnGames(content);
  if (!segments.length || segments.length > 10_000)
    throw new Error("Choose an archive containing up to 10,000 games.");
  return segments.map(({ pgn }) => {
    const chess = loadOfflinePgn(pgn);
    const headers = chess.getHeaders();
    // Missing/unknown PGN dates use a stable sentinel, so importing twice still skips duplicates.
    const date = /^\d{4}\.\d{2}\.\d{2}$/.test(headers.Date ?? "")
      ? `${headers.Date.replaceAll(".", "-")}T00:00:00.000Z`
      : "1970-01-01T00:00:00.000Z";
    return validatedGame({
      id: crypto.randomUUID(),
      createdAt: headers.ChessterCreatedAt ?? date,
      whitePlayer: headers.White || "White",
      blackPlayer: headers.Black || "Black",
      result: headers.Result || "*",
      pgn,
    });
  });
}
