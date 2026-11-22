import { describe, expect, it } from "vitest";
import { normalizeProfile, type RecentGame } from "../src/api/profileApi";
import { calculateOpeningStats, getProfileView, getTopOpenings } from "../src/utils/profileStats";

const game = (code: string, result: RecentGame["result"], openingName?: string, openingEco?: string): RecentGame => ({
  gameCode: code, result, openingName, openingEco, mode: "blitz", color: "black",
  opponentAddress: "OPPONENT", opponentName: null, ratingChange: null, playedAt: null,
});

describe("opening performance aggregation", () => {
  it("retains all six real backend clock presets in their opening-performance mode tabs", () => {
    const profile = normalizeProfile({
      recentMatches: ["bullet", "bullet2", "blitz", "blitz5", "rapid", "rapid15"].map((preset) => ({
        gameCode: preset, mode: preset, color: "black", result: "loss",
        openingName: "Sicilian Defense", openingEco: null,
      })),
    }, "OWNER");
    for (const family of ["bullet", "blitz", "rapid"] as const) {
      const view = getProfileView(profile, family);
      expect(view.recentGames.map((game) => game.gameCode)).toEqual(
        family === "bullet" ? ["bullet", "bullet2"] : family === "blitz" ? ["blitz", "blitz5"] : ["rapid", "rapid15"],
      );
      expect(view.openingSampleSize).toBe(2);
      expect(view.openingStats[0]).toMatchObject({ total: 2, losses: 2, wins: 0 });
    }
  });

  it("counts results from the profile owner's perspective and computes rates", () => {
    const stats = calculateOpeningStats([
      game("1", "win", "Sicilian Defense", "B20"),
      game("2", "loss", "Sicilian Defense", "B20"),
      game("3", "win", "Sicilian Defense", "B20"),
      game("4", "draw", "Queen's Gambit", "D06"),
      game("5", "loss", "Queen's Gambit", "D06"),
      game("6", "draw"),
    ]);
    expect(stats[0]).toEqual({ name: "Sicilian Defense", eco: "B20", total: 3, wins: 2, losses: 1, draws: 0, winRate: 66.7 });
    expect(stats[1]).toMatchObject({ name: "Queen's Gambit", total: 2, wins: 0, losses: 1, draws: 1, winRate: 0 });
    expect(stats[2]).toMatchObject({ name: "Unknown Opening", eco: null, total: 1, draws: 1 });
  });

  it("excludes unfinished or malformed results and does not guess ECO codes", () => {
    expect(calculateOpeningStats([
      { ...game("1", "win", " French Defense "), status: "finished" },
      { ...game("2", "win", "French Defense"), status: "active" },
      { ...game("3", "win"), result: "pending" as RecentGame["result"] },
      { ...game("4", "draw"), status: "cancelled" },
    ])).toEqual([{ name: "French Defense", eco: null, total: 1, wins: 1, losses: 0, draws: 0, winRate: 100 }]);
  });

  it("uses a stable top-five order and respects bounded limits", () => {
    const games = ["F", "E", "D", "C", "B", "A"].map((name) => game(name, "win", name));
    expect(getTopOpenings(games).map((stat) => stat.name)).toEqual(["A", "B", "C", "D", "E"]);
    expect(calculateOpeningStats(games, 1)).toHaveLength(1);
    expect(calculateOpeningStats(games, 0)).toEqual([]);
    expect(calculateOpeningStats(games, -1)).toEqual([]);
    expect(calculateOpeningStats(games, Number.NaN)).toEqual([]);
  });

  it("keeps distinct ECO variants and never changes input records", () => {
    const games = Object.freeze([
      Object.freeze(game("1", "win", "Sicilian Defense", "B20")),
      Object.freeze(game("2", "draw", "Sicilian Defense", "B90")),
    ]);
    expect(calculateOpeningStats(games)).toHaveLength(2);
    expect(games[0].openingEco).toBe("B20");
  });

  it("aggregates the full returned mode sample before slicing recent game rows", () => {
    const games = Array.from({ length: 12 }, (_, i) => game(String(i), "win", "French Defense"));
    const profile = {
      address: "OWNER", username: null, avatarUrl: null, rating: 1200,
      stats: { games: 13, wins: 13, draws: 0, losses: 0 }, modes: {}, ratingHistory: [],
      recentGames: [...games, { ...game("rapid", "loss", "English Opening"), mode: "rapid" as const }],
    };
    const view = getProfileView(profile, "blitz");
    expect(view.recentGames).toHaveLength(10);
    expect(view.openingStats[0].total).toBe(12);
    expect(view.openingSampleSize).toBe(12);
  });
});
