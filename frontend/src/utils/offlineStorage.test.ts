import { beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { webcrypto } from "node:crypto";
import { Chess } from "chess.js";
import {
  exportOfflineGamesToJSON,
  exportOfflineGamesToPGN,
  getAllOfflineGames,
  importOfflineGames,
  loadOfflinePgn,
  saveOfflineGame,
  type OfflineGame,
} from "./offlineStorage";

const game: OfflineGame = {
  id: "first",
  createdAt: "2026-11-19T10:30:00.000Z",
  whitePlayer: "Alice",
  blackPlayer: "Bob",
  result: "1-0",
  pgn: "1. e4 e5 2. Nf3 Nc6 1-0",
};
beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("crypto", webcrypto);
});

describe("offline replay archives", () => {
  it("exports empty and selected versioned JSON archives", async () => {
    expect(JSON.parse(await exportOfflineGamesToJSON())).toEqual({ version: 1, games: [] });
    expect(await exportOfflineGamesToPGN()).toBe("");
    await saveOfflineGame(game);
    await saveOfflineGame({ ...game, id: "second", createdAt: "2026-11-20T00:00:00.000Z" });
    const saved = await getAllOfflineGames();
    const archive = JSON.parse(await exportOfflineGamesToJSON([saved[1].id]));
    expect(archive.games).toHaveLength(1);
    expect(archive.games[0]).toMatchObject({ ...game, id: saved[1].id });
    expect(JSON.parse(await exportOfflineGamesToJSON([])).games).toEqual([]);
  });

  it("exports valid PGN metadata and restores timestamps across formats", async () => {
    await saveOfflineGame(game);
    const pgn = await exportOfflineGamesToPGN();
    expect(pgn).toContain('[Date "2026.11.19"]');
    expect(pgn).toContain('[White "Alice"]');
    expect(pgn).toContain('[Result "1-0"]');
    const chess = new Chess();
    chess.loadPgn(pgn);
    expect(chess.history()).toEqual(["e4", "e5", "Nf3", "Nc6"]);
    expect(await importOfflineGames(pgn)).toEqual({ imported: 0, skipped: 1 });
    const json = await exportOfflineGamesToJSON();
    vi.stubGlobal("indexedDB", new IDBFactory());
    expect(await importOfflineGames(json)).toEqual({ imported: 1, skipped: 0 });
    expect(await importOfflineGames(pgn)).toEqual({ imported: 0, skipped: 1 });
  });

  it("escapes quotes and backslashes in exported PGN player tags", async () => {
    await saveOfflineGame({ ...game, whitePlayer: 'Alice "the queen"', blackPlayer: "Bob\\Guest" });
    const pgn = await exportOfflineGamesToPGN();
    expect(pgn).toContain('[White "Alice \\"the queen\\""]');
    expect(pgn).toContain('[Black "Bob\\\\Guest"]');
    const chess = loadOfflinePgn(pgn);
    expect(await importOfflineGames(pgn)).toEqual({ imported: 0, skipped: 1 });
    expect(chess.getHeaders().White).toBe('Alice "the queen"');
  });

  it("imports collections and ignores duplicate IDs only when timestamp and moves match", async () => {
    const second = { ...game, pgn: "1. d4 d5 *", result: "*" };
    expect(await importOfflineGames(JSON.stringify([game, game, second]))).toEqual({
      imported: 2,
      skipped: 1,
    });
    expect(await getAllOfflineGames()).toHaveLength(2);
    expect(
      await importOfflineGames(
        JSON.stringify([{ ...game, pgn: "1.e4 {comment} e5 2.Nf3 Nc6 1-0" }])
      )
    ).toEqual({ imported: 0, skipped: 1 });
  });

  it("parses PGN collections and deterministically skips unknown dates", async () => {
    const pgn =
      '[Event "First"]\n[White "Alice"]\n[Black "Bob"]\n[Result "*"]\n\n1. e4 e5 *\n\n[Event "Second"]\n[Result "*"]\n\n1. d4 d5 *';
    expect(await importOfflineGames(pgn)).toEqual({ imported: 2, skipped: 0 });
    expect(await importOfflineGames(pgn)).toEqual({ imported: 0, skipped: 2 });
  });

  it.each([
    "",
    "{broken",
    '{"version":2,"games":[]}',
    "1. nonsense *",
    JSON.stringify([{ ...game, createdAt: "bad date" }]),
    JSON.stringify([game, { ...game, result: "invalid" }]),
    JSON.stringify([game, { ...game, pgn: "1. e5 *" }]),
    JSON.stringify([{ ...game, result: "0-1" }]),
    '[Result "0-1"]\n\n1. e4 e5 1-0',
    JSON.stringify([{ ...game, result: "0-1", pgn: '[Result "0-1"]\n\n1. e4 e5 1-0' }]),
  ])("rejects invalid input without writing any games: %s", async (content) => {
    await expect(importOfflineGames(content)).rejects.toThrow();
    expect(await getAllOfflineGames()).toEqual([]);
  });

  it("keeps concurrent imports atomic and skips duplicate replays", async () => {
    const results = await Promise.all([
      importOfflineGames(JSON.stringify([game])),
      importOfflineGames(JSON.stringify([game])),
    ]);
    expect(results.reduce((n, r) => n + r.imported, 0)).toBe(1);
    expect(results.reduce((n, r) => n + r.skipped, 0)).toBe(1);
    expect(await getAllOfflineGames()).toHaveLength(1);
  });

  it("preserves custom FEN starting positions in PGN export", async () => {
    const pgn = '[SetUp "1"]\n[FEN "8/8/8/8/8/8/4K3/7k w - - 0 1"]\n[Result "*"]\n\n1. Kf3 *';
    await importOfflineGames(pgn);
    const exported = await exportOfflineGamesToPGN();
    expect(exported).toContain('[SetUp "1"]');
    const chess = new Chess();
    chess.loadPgn(exported);
    expect(chess.history()).toEqual(["Kf3"]);
  });
});
