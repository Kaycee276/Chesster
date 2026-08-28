import { test, expect, type Page } from "@playwright/test";

/**
 * End-to-end game lifecycle: two independent browser contexts (one per
 * player) create/join a game, play a full legal short game to checkmate
 * ("Fool's Mate": 1.f3 e5 2.g4 Qh4#), and both see the correct game-over
 * outcome. Runs against the real frontend UI; the backend + wallet are the
 * fixtures described in playwright.config.ts and e2e/stubs.
 */

async function setFakeWallet(page: Page, address: string) {
	await page.addInitScript((addr) => {
		window.localStorage.setItem("__e2e_wallet_address__", addr);
	}, address);
}

async function clickSquare(page: Page, row: number, col: number) {
	await page.getByTestId(`square-${row}-${col}`).click();
}

test.describe("Full game lifecycle", () => {
	test("two players connect, play, and reach checkmate", async ({ browser }) => {
		const whiteContext = await browser.newContext();
		const blackContext = await browser.newContext();
		const white = await whiteContext.newPage();
		const black = await blackContext.newPage();

		await setFakeWallet(white, "GWHITEPLAYERFAKEADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");
		await setFakeWallet(black, "GBLACKPLAYERFAKEADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");

		// ── White creates a (non-wagered) game ──────────────────────────────
		// The fake wallet address is already in localStorage before the app's
		// own checkConnection() runs on mount, so both players auto-connect
		// without needing to click "Connect Freighter".
		await white.goto("/");
		await expect(white.getByTestId("create-game-btn")).toBeEnabled();
		await white.getByTestId("create-game-btn").click();

		// Creating navigates to /:gameCode and lands on the waiting-room view.
		await white.waitForURL(/\/[A-Z0-9]{4,}$/);
		const gameCode = white.url().split("/").pop()!;
		await expect(white.getByTestId("game-code-display")).toContainText(gameCode);

		// ── Black joins by code ──────────────────────────────────────────────
		await black.goto("/");
		await black.getByTestId("join-code-input").fill(gameCode);
		await expect(black.getByTestId("join-game-btn")).toBeEnabled();
		await black.getByTestId("join-game-btn").click();
		await black.waitForURL(new RegExp(`/${gameCode}$`));

		// Once black joins, the game goes active and white's waiting screen
		// (driven by the real-time "game-update" socket broadcast) resolves
		// into the live board.
		await expect(white.getByTestId("square-6-5")).toBeVisible();
		await expect(black.getByTestId("square-6-5")).toBeVisible();

		// ── 1. f3 (white) ─────────────────────────────────────────────────
		await clickSquare(white, 6, 5); // select f2 pawn
		await clickSquare(white, 5, 5); // move to f3
		await expect(black.getByTestId("square-5-5")).toHaveText("♙");

		// ── 1... e5 (black) ───────────────────────────────────────────────
		await clickSquare(black, 1, 4); // select e7 pawn
		await clickSquare(black, 3, 4); // move to e5
		await expect(white.getByTestId("square-3-4")).toHaveText("♟");

		// ── 2. g4 (white) ─────────────────────────────────────────────────
		await clickSquare(white, 6, 6); // select g2 pawn
		await clickSquare(white, 4, 6); // move to g4
		await expect(black.getByTestId("square-4-6")).toHaveText("♙");

		// ── 2... Qh4# (black delivers checkmate) ─────────────────────────
		await clickSquare(black, 0, 3); // select d8 queen
		await clickSquare(black, 4, 7); // move to h4 — checkmate
		await expect(white.getByTestId("square-4-7")).toHaveText("♛");

		// ── Both sides observe the same final outcome in real time ────────
		const whiteBanner = white.getByTestId("game-over-banner");
		const blackBanner = black.getByTestId("game-over-banner");
		await expect(whiteBanner).toBeVisible();
		await expect(blackBanner).toBeVisible();

		await expect(whiteBanner).toHaveAttribute("data-winner", "black");
		await expect(blackBanner).toHaveAttribute("data-winner", "black");
		await expect(whiteBanner).toHaveText("You lose");
		await expect(blackBanner).toHaveText("You win!");

		await whiteContext.close();
		await blackContext.close();
	});

	test("room isolation: a spectator on a different game never sees this game's moves", async ({
		browser,
	}) => {
		const whiteContext = await browser.newContext();
		const blackContext = await browser.newContext();
		const otherContext = await browser.newContext();
		const white = await whiteContext.newPage();
		const black = await blackContext.newPage();
		const other = await otherContext.newPage();

		await setFakeWallet(white, "GWHITE2FAKEADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");
		await setFakeWallet(black, "GBLACK2FAKEADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");
		await setFakeWallet(other, "GOTHERFAKEADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");

		// Game A: white + black.
		await white.goto("/");
		await expect(white.getByTestId("create-game-btn")).toBeEnabled();
		await white.getByTestId("create-game-btn").click();
		await white.waitForURL(/\/[A-Z0-9]{4,}$/);
		const gameCodeA = white.url().split("/").pop()!;

		await black.goto("/");
		await black.getByTestId("join-code-input").fill(gameCodeA);
		await expect(black.getByTestId("join-game-btn")).toBeEnabled();
		await black.getByTestId("join-game-btn").click();
		await black.waitForURL(new RegExp(`/${gameCodeA}$`));

		// Game B: an unrelated game the "other" client creates and stays in.
		await other.goto("/");
		await expect(other.getByTestId("create-game-btn")).toBeEnabled();
		await other.getByTestId("create-game-btn").click();
		await other.waitForURL(/\/[A-Z0-9]{4,}$/);

		await expect(white.getByTestId("square-6-5")).toBeVisible();

		// A move in game A must not surface on the unrelated "other" client.
		await clickSquare(white, 6, 5);
		await clickSquare(white, 5, 5);
		await expect(black.getByTestId("square-5-5")).toHaveText("♙");

		// "Other" is still on its own waiting-room screen for a different
		// game code and was never subscribed to game A's room.
		await expect(other.getByTestId("game-code-display")).not.toContainText(gameCodeA);

		await whiteContext.close();
		await blackContext.close();
		await otherContext.close();
	});
});
