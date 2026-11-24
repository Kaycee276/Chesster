import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchTournamentById } from "./tournamentApi";

vi.mock("./gameApi", () => ({ API_URL: "/api", csrfFetch: vi.fn() }));

afterEach(() => vi.unstubAllGlobals());

function respond(payload: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => payload }));
}

const tournament = {
  id: "tournament-765", title: "Lifecycle Cup", status: "active",
  entry_fee: 10, prize_pool: 40, max_players: 4,
};

describe("tournament detail bracket wire contract", () => {
  it("adapts production match numbers and in-progress status for live navigation", async () => {
    const match = Object.freeze({
      id: "match-765", round: 1, match_number: 2, status: "in_progress",
      player_one: "Alice", player_two: "Bob", game_code: "SWISS765A",
    });
    respond({ success: true, tournament: { ...tournament, status: "in_progress", bracket_matches: [match] } });
    const result = await fetchTournamentById(tournament.id);
    expect(result.bracket_matches?.[0]).toMatchObject({ position: 2, status: "live", game_code: "SWISS765A" });
    expect(result.status).toBe("active");
    expect(match.status).toBe("in_progress");
    expect(match).not.toHaveProperty("position");
  });

  it("preserves legacy data-envelope positions and live status", async () => {
    const match = { id: "legacy", round: 1, position: 7, match_number: 2, status: "live" };
    respond({ success: true, data: { ...tournament, bracket_matches: [match] } });
    const result = await fetchTournamentById(tournament.id);
    expect(result.bracket_matches?.[0]).toMatchObject({ position: 7, status: "live" });
  });

  it("preserves completed winners and the backend winner-address alias", async () => {
    respond({ success: true, tournament: { ...tournament, bracket_matches: [
      { id: "completed", round: 2, match_number: 1, status: "completed", winner_address: "Alice" },
      { id: "ready", round: 2, match_number: 2, status: "ready" },
    ] } });
    const result = await fetchTournamentById(tournament.id);
    expect(result.bracket_matches?.map((match) => [match.position, match.status, match.winner])).toEqual([
      [1, "completed", "Alice"], [2, "ready", null],
    ]);
  });

  it("handles a missing bracket array without inventing live matches", async () => {
    respond({ success: true, tournament });
    const result = await fetchTournamentById(tournament.id);
    expect(result.bracket_matches).toEqual([]);
  });

  it("rejects a successful envelope without tournament data", async () => {
    respond({ success: true });
    await expect(fetchTournamentById(tournament.id)).rejects.toThrow("Missing tournament data");
  });
});
