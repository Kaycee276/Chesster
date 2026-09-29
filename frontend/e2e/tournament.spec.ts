import { expect, test, type Page } from "@playwright/test";

const tournament = {
  id: 42,
  title: "Stellar Cup",
  entry_fee: 10,
  prize_pool: 80,
  max_players: 8,
  participant_count: 8,
  status: "active",
};

const bracketMatches = [
  { id: "qf-1", round: 1, position: 1, player_one: "Alice", player_two: "Bob", winner: "Alice", status: "completed" },
  { id: "qf-2", round: 1, position: 2, player_one: "Carol", player_two: "Dan", status: "live", game_code: "LIVE-MATCH" },
  { id: "qf-3", round: 1, position: 3, player_one: "Eve", player_two: "Finn", winner: "Eve", status: "completed" },
  { id: "qf-4", round: 1, position: 4, player_one: "Grace", player_two: "Hugo", winner: "Grace", status: "completed" },
  { id: "sf-1", round: 2, position: 1, player_one: "Alice", player_two: "Carol", status: "ready" },
  { id: "sf-2", round: 2, position: 2, player_one: "Eve", player_two: "Grace", status: "pending" },
  { id: "final-1", round: 3, position: 1, player_one: null, player_two: null, status: "pending" },
];

async function mockTournamentApi(page: Page) {
  await page.route("**/api/tournaments**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/42")) {
      await route.fulfill({ json: { success: true, data: { ...tournament, bracket_matches: bracketMatches } } });
      return;
    }
    await route.fulfill({ json: { success: true, data: [tournament] } });
  });
}

test.describe("tournament registration and bracket view", () => {
  test.beforeEach(async ({ page }) => {
    await mockTournamentApi(page);
  });

  test("opens a mocked tournament bracket with all rounds", async ({ page }) => {
    await page.goto("/tournaments");
    await expect(page.getByRole("heading", { name: "Tournaments" })).toBeVisible();
    await page.getByRole("button", { name: "View Bracket" }).click();
    await expect(page).toHaveURL(/\/tournaments\/42\/bracket$/);
    await expect(page.getByRole("heading", { name: "Quarterfinals" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Semifinals" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Finals", exact: true })).toBeVisible();
  });

  test("offers spectator access for a live match and shows the ready modal", async ({ page }) => {
    await page.goto("/tournaments/42/bracket");
    await page.getByRole("link", { name: "Watch as spectator" }).click();
    await expect(page).toHaveURL(/\/spectate\/LIVE-MATCH$/);

    await page.goto("/tournaments/42/bracket");
    await page.getByRole("button", { name: "Match Ready" }).click();
    await expect(page.getByRole("heading", { name: "Tournament Match Ready" })).toBeVisible();
  });

  test("switches theme settings and keeps the bracket usable on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/tournaments/42/bracket");
    await page.getByRole("button", { name: "Open board theme picker" }).click();
    await page.getByRole("button", { name: "Light" }).click();
    await expect(page.getByText("Tournament bracket", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Finals", exact: true })).toBeVisible();
  });
});
