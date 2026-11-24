import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const tournamentId = "76500000-0000-4000-8000-000000000001";
const players = ["Alice", "Bob", "Carol", "Dan"];
interface SnapshotMatch {
  id: string;
  round: number;
  match_number: number;
  player_one: string;
  player_two: string;
  status: string;
  game_code?: string;
  winner?: string;
}

const roundOne: SnapshotMatch[] = [
  { id: "swiss-1-1", round: 1, match_number: 1, player_one: players[0], player_two: players[1], status: "in_progress", game_code: "SWISS765A" },
  { id: "swiss-1-2", round: 1, match_number: 2, player_one: players[2], player_two: players[3], status: "in_progress", game_code: "SWISS765B" },
];
const roundTwo: SnapshotMatch[] = [
  { id: "swiss-2-1", round: 2, match_number: 1, player_one: players[0], player_two: players[2], status: "ready" },
  { id: "swiss-2-2", round: 2, match_number: 2, player_one: players[1], player_two: players[3], status: "ready" },
];

test("four isolated viewers follow Swiss bracket snapshots and navigate to a live game", async ({ browser, baseURL }) => {
  // Browser coverage is intentionally a rendering contract. Real service/HTTP/WS
  // behavior is exercised in backend/tests/tournamentLifecycle.test.js; production
  // has no create/start/settle Swiss API to drive a full browser lifecycle yet.
  test.setTimeout(60_000);
  let snapshot = {
    id: tournamentId, title: "Lifecycle Cup", entry_fee: 10, prize_pool: 40,
    max_players: 4, participant_count: 4, status: "active", bracket_matches: roundOne,
  };
  let contexts: BrowserContext[] = [];
  let pages: Page[] = [];
  try {
    for (const player of players) {
      const context = await browser.newContext({ baseURL });
      contexts = [...contexts, context];
      await context.addInitScript((name) => {
        localStorage.setItem("tournament-test-viewer", name);
      }, player);
      const page = await context.newPage();
      pages = [...pages, page];
      await page.route(`**/api/tournaments/${tournamentId}`, (route) =>
        route.fulfill({ json: { success: true, tournament: snapshot } }));
      await page.route("**/socket.io/**", (route) => route.abort());
      await page.goto(`/tournaments/${tournamentId}/bracket`);
      await expect(page.getByRole("heading", { name: "Lifecycle Cup" })).toBeVisible();
      expect(await page.evaluate(() => localStorage.getItem("tournament-test-viewer"))).toBe(player);
      await expect(page.getByRole("link", { name: "Watch as spectator" })).toHaveCount(2);
      await expect(page.getByText("Match 1", { exact: true })).toHaveCount(1);
      await expect(page.getByText("Match 2", { exact: true })).toHaveCount(1);
      await expect(page.locator("article").filter({ hasText: "Alice" })).toContainText("Bob");
      await expect(page.locator("article").filter({ hasText: "Carol" })).toContainText("Dan");
    }

    await pages[0].getByRole("link", { name: "Watch as spectator" }).first().click();
    await expect(pages[0]).toHaveURL(/\/spectate\/SWISS765A$/);

    snapshot = { ...snapshot, bracket_matches: [
      ...roundOne.map((match, index) => ({ ...match, status: "completed", winner: index === 0 ? "Alice" : "Carol" })),
      ...roundTwo,
    ] };
    for (const page of pages) {
      await page.goto(`/tournaments/${tournamentId}/bracket`);
      const winnerMatch = page.locator("article").filter({ hasText: "Alice" }).filter({ hasText: "Carol" });
      await expect(winnerMatch).toHaveCount(1);
      await winnerMatch.getByRole("button", { name: "Match Ready" }).click();
      const dialog = page.getByRole("dialog", { name: "Tournament Match Ready" });
      await expect(dialog).toContainText("Alice vs Carol");
      await dialog.getByRole("button", { name: "Continue" }).click();
      await expect(dialog).toHaveCount(0);
    }

    snapshot = { ...snapshot, status: "completed", bracket_matches: snapshot.bracket_matches.map((match) =>
      ({ ...match, status: "completed" })) };
    for (const page of pages) {
      await page.reload();
      await expect(page.locator("article")).toHaveCount(4);
      await expect(page.getByRole("button", { name: "Match Ready" })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Watch as spectator" })).toHaveCount(0);
    }
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
