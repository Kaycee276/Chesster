import { expect, test, type Page } from "@playwright/test";

/**
 * Visual regression coverage for chessboard theming and the app's overlay
 * modals, driven with Playwright's built-in screenshot diffing.
 *
 * Board theming is exercised through the `ThemeSelector` panel (its swatches
 * drive the same `--sq-light`/`--sq-dark` CSS variables the live board
 * reads), and modal coverage spans `GameSettings` and the lobby's new
 * `ShareMatchModal`. These were chosen over the in-game `ChessBoard`/
 * `GameResultModal` route because that pair had pre-existing, unrelated
 * duplicate-JSX corruption that prevented the whole app from even compiling
 * in dev mode; that corruption has been cleaned up alongside this suite (see
 * the PR description) purely so these new tests — and the app itself — can
 * run at all.
 */

const THEME_STORAGE_KEY = "chesster_theme";

async function seedTheme(page: Page, boardTheme = "classic") {
	await page.addInitScript(
		({ key, boardTheme }) => {
			window.localStorage.setItem(
				key,
				JSON.stringify({
					state: { boardTheme, pieceSet: "standard", colorMode: "light" },
					version: 0,
				}),
			);
		},
		{ key: THEME_STORAGE_KEY, boardTheme },
	);
}

test.describe("visual regression", () => {
	test.beforeEach(async ({ page }) => {
		await seedTheme(page);
	});

	test("game lobby renders consistently in the disconnected state", async ({ page }) => {
		await page.goto("/", { waitUntil: "domcontentloaded" });
		await expect(page.getByRole("heading", { name: "Chesster" })).toBeVisible();

		await expect(page).toHaveScreenshot("lobby-disconnected.png", {
			fullPage: true,
		});
	});

	test("theme selector panel shows every board theme swatch", async ({ page }) => {
		await page.goto("/", { waitUntil: "domcontentloaded" });

		await page.getByRole("button", { name: "Open board theme picker" }).click();
		await expect(page.getByText("Theme Settings")).toBeVisible();

		const panel = page.getByText("Theme Settings").locator("..").locator("..");
		await expect(panel).toHaveScreenshot("theme-selector-panel-classic.png");
	});

	test("switching board theme updates the selected swatch", async ({ page }) => {
		await page.goto("/", { waitUntil: "domcontentloaded" });

		await page.getByRole("button", { name: "Open board theme picker" }).click();
		await page.getByRole("button", { name: "Neon", exact: false }).click();

		// Re-open — selecting a theme closes the panel — to capture the
		// persisted selection rendering with its checkmark.
		await page.getByRole("button", { name: "Open board theme picker" }).click();
		const panel = page.getByText("Theme Settings").locator("..").locator("..");
		await expect(panel).toHaveScreenshot("theme-selector-panel-neon.png");

		const dark = await page.evaluate(() =>
			document.documentElement.style.getPropertyValue("--sq-dark"),
		);
		expect(dark).toBe("#0b1020");
	});

	test("game settings modal (blindfold toggle) renders consistently", async ({ page }) => {
		await page.goto("/", { waitUntil: "domcontentloaded" });

		await page.getByRole("button", { name: "Open game settings" }).click();
		await expect(page.getByText("Blindfold Mode")).toBeVisible();

		const modal = page.getByText("Game Settings").locator("..").locator("..");
		await expect(modal).toHaveScreenshot("game-settings-modal-off.png");

		await page.getByRole("switch", { name: "Toggle blindfold mode" }).click();
		await expect(modal).toHaveScreenshot("game-settings-modal-on.png");
	});

	test("share match link modal renders a QR code for a created game", async ({ page }) => {
		await page.route("**/api/games/pending", (route) =>
			route.fulfill({ json: { success: true, data: [] } }),
		);
		await page.route("**/api/games", (route) =>
			route.fulfill({
				json: { success: true, data: { game_code: "SHARE01" } },
			}),
		);
		await page.route("**/api/games/SHARE01/join", (route) =>
			route.fulfill({ json: { success: true, data: {} } }),
		);
		await page.route("**/api/games/SHARE01", (route) =>
			route.fulfill({
				json: {
					success: true,
					data: { status: "waiting", board_state: [], current_turn: "white" },
				},
			}),
		);
		await page.route("**/api/games/SHARE01/moves", (route) =>
			route.fulfill({ json: { success: true, data: [] } }),
		);
		await page.route("**/api/games/SHARE01/chat", (route) =>
			route.fulfill({ json: { success: true, data: [] } }),
		);
		await page.route("**/socket.io/**", (route) => route.abort());

		// Pre-seed a CSRF cookie so `csrfFetch` skips its token round-trip to
		// a (non-existent, in this test) backend before the create/join POSTs.
		await page.addInitScript(() => {
			document.cookie = "XSRF-TOKEN=visual-test-token; path=/";
		});

		// Stub the Freighter browser-extension bridge so `connect()` resolves
		// with a deterministic address without a real wallet installed.
		await page.addInitScript(() => {
			window.addEventListener("message", (event) => {
				if (event.source !== window) return;
				const data = event.data as { type?: string; messageId?: number } | undefined;
				if (data?.type === "REQUEST_ACCESS") {
					window.postMessage(
						{
							source: "FREIGHTER_EXTERNAL_MSG_RESPONSE",
							messagedId: data.messageId,
							publicKey: "GVISUALTESTPLAYERADDRESS0000000000000000",
						},
						window.location.origin,
					);
				}
			});
		});

		await page.goto("/", { waitUntil: "domcontentloaded" });
		await page.getByRole("button", { name: "Connect Freighter" }).click();
		await page.getByRole("button", { name: "Create New Game" }).click();

		await expect(page.getByText("Share Match Link")).toBeVisible();
		await expect(page.getByAltText("QR code to join game SHARE01")).toBeVisible();

		await expect(page).toHaveScreenshot("share-match-modal.png", { fullPage: true });
	});
});
