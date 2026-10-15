import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { injectMockFreighter, MOCK_FREIGHTER_ADDRESS } from "./fixtures/mockFreighter";

const GAME_CODE = "GAME123";
const WHITE_ADDRESS = "GWHITEADDRESS1234567890";
const BLACK_ADDRESS = "GBLACKADDRESS1234567890";

const initialBoard = [
	["r", "n", "b", "q", "k", "b", "n", "r"],
	["p", "p", "p", "p", "p", "p", "p", "p"],
	[".", ".", ".", ".", ".", ".", ".", "."],
	[".", ".", ".", ".", ".", ".", ".", "."],
	[".", ".", ".", ".", ".", ".", ".", "."],
	[".", ".", ".", ".", ".", ".", ".", "."],
	["P", "P", "P", "P", "P", "P", "P", "P"],
	["R", "N", "B", "Q", "K", "B", "N", "R"],
];

const afterWhiteMove = [
	["r", "n", "b", "q", "k", "b", "n", "r"],
	["p", "p", "p", "p", "p", "p", "p", "p"],
	[".", ".", ".", ".", ".", ".", ".", "."],
	[".", ".", ".", ".", ".", ".", ".", "."],
	[".", ".", ".", ".", "P", ".", ".", "."],
	[".", ".", ".", ".", ".", ".", ".", "."],
	["P", "P", "P", "P", ".", "P", "P", "P"],
	["R", "N", "B", "Q", "K", "B", "N", "R"],
];

function gameState(board = initialBoard, currentTurn: "white" | "black" = "white") {
	return {
		game_code: GAME_CODE,
		game_type: "chess",
		board_state: board,
		current_turn: currentTurn,
		status: "active",
		time_control_seconds: 600,
		game_started_at: new Date().toISOString(),
		turn_started_at: new Date().toISOString(),
		wager_amount: null,
	};
}

async function seedGame(context: BrowserContext, color: "white" | "black", address: string) {
	await context.addInitScript(
		({ gameCode, playerColor, playerAddress, board }) => {
			window.localStorage.setItem(
				"chesster-game",
				JSON.stringify({
					state: {
						gameCode,
						playerColor,
						playerAddress,
						board,
						currentTurn: "white",
						status: "active",
						secondsLeft: 600,
						timeControlSeconds: 600,
						chatMessages: [],
						unreadCount: 0,
						chatOpen: false,
					},
					version: 0,
				}),
			);
		},
		{ gameCode: GAME_CODE, playerColor: color, playerAddress: address, board: initialBoard },
	);
}

async function mockApi(page: Page) {
	let current = gameState();

	await page.route("**/socket.io/**", (route) => route.abort());
	await page.route("**/api/games/*/chat", (route) =>
		route.fulfill({ json: { success: true, data: [] } }),
	);
	await page.route("**/api/games/*/move", async (route) => {
		const body = await route.request().postDataJSON();
		expect(body).toMatchObject({ from: [6, 4], to: [4, 4] });
		current = gameState(afterWhiteMove, "black");
		await route.fulfill({ json: { success: true, data: current } });
	});
	await page.route("**/api/games/*", (route) =>
		route.fulfill({ json: { success: true, data: current } }),
	);
}

test("two player contexts can enter an active game and submit a move", async ({ browser }) => {
	const whiteContext = await browser.newContext();
	const blackContext = await browser.newContext();
	await seedGame(whiteContext, "white", WHITE_ADDRESS);
	await seedGame(blackContext, "black", BLACK_ADDRESS);

	const white = await whiteContext.newPage();
	const black = await blackContext.newPage();
	await mockApi(white);
	await mockApi(black);

	await Promise.all([
		white.goto(`/${GAME_CODE}`, { waitUntil: "domcontentloaded" }),
		black.goto(`/${GAME_CODE}`, { waitUntil: "domcontentloaded" }),
	]);

	await expect(white.getByText("You · white")).toBeVisible();
	await expect(black.getByText("You · black")).toBeVisible();
	await expect(white.getByTitle("Copy game code")).toContainText(GAME_CODE);
	await expect(black.getByTitle("Copy game code")).toContainText(GAME_CODE);

	await white.getByTestId("square-6-4").click();
	await white.getByTestId("square-4-4").click();

	await expect(white.getByText("your turn next")).toBeVisible();

	await whiteContext.close();
	await blackContext.close();
});

test("Player can connect wallet, create 5+0 lobby match, and receive shareable link", async ({
	page,
	context,
}) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	await injectMockFreighter(page, MOCK_FREIGHTER_ADDRESS);

	const createdGameCode = "LOBBY50";

	await page.route("**/api/csrf-token", (route) =>
		route.fulfill({ json: { success: true, token: "mock-csrf" } }),
	);
	await page.route("**/socket.io/**", (route) => route.abort());
	await page.route("**/api/tournaments**", (route) =>
		route.fulfill({ json: { success: true, data: [] } }),
	);
	await page.route("**/api/games/pending**", (route) =>
		route.fulfill({ json: { success: true, data: [] } }),
	);
	await page.route("**/api/games", async (route) => {
		if (route.request().method() === "POST") {
			await route.fulfill({
				json: {
					success: true,
					data: {
						game_code: createdGameCode,
						game_type: "chess",
						status: "pending",
						time_control_seconds: 300,
						time_increment_seconds: 0,
						player_white_address: MOCK_FREIGHTER_ADDRESS,
					},
				},
			});
			return;
		}
		await route.continue();
	});
	await page.route(`**/api/games/${createdGameCode}/join`, (route) =>
		route.fulfill({ json: { success: true, data: { game_code: createdGameCode } } }),
	);
	await page.route(`**/api/games/${createdGameCode}`, (route) =>
		route.fulfill({
			json: {
				success: true,
				data: {
					game_code: createdGameCode,
					game_type: "chess",
					status: "pending",
					time_control_seconds: 300,
					time_increment_seconds: 0,
					board_state: initialBoard,
					current_turn: "white",
					player_white_address: MOCK_FREIGHTER_ADDRESS,
				},
			},
		}),
	);
	await page.route(`**/api/games/${createdGameCode}/moves`, (route) =>
		route.fulfill({ json: { success: true, data: [] } }),
	);
	await page.route(`**/api/games/${createdGameCode}/chat`, (route) =>
		route.fulfill({ json: { success: true, data: [] } }),
	);
	await page.route("**/accounts/**", (route) =>
		route.fulfill({
			json: {
				balances: [{ asset_type: "native", asset_code: "XLM", balance: "100.00" }],
			},
		}),
	);

	await page.goto("/", { waitUntil: "domcontentloaded" });

	// 1. Initial state: Connect wallet button is visible
	const connectButton = page.getByRole("button", { name: /^(Connect )?Freighter$/i });
	await expect(connectButton).toBeVisible();

	// 2. Click Connect Wallet and verify transition to active public key badge
	await connectButton.click();
	const shortenedAddress = `${MOCK_FREIGHTER_ADDRESS.slice(0, 4)}…${MOCK_FREIGHTER_ADDRESS.slice(-4)}`;
	await expect(page.getByText(shortenedAddress)).toBeVisible();
	await expect(page.getByText("freighter")).toBeVisible();

	// 3. Select 5+0 time control (5 min Blitz)
	const blitzButton = page.getByRole("button", { name: /5 min.*Blitz/i });
	await expect(blitzButton).toBeVisible();
	await blitzButton.click();
	await expect(blitzButton).toContainText("Blitz");
	await expect(blitzButton).toHaveClass(/border-\(--accent-primary\)/);

	// 4. Create match lobby
	const createButton = page.getByRole("button", { name: "Create New Game" });
	await expect(createButton).toBeEnabled();

	const createRequestPromise = page.waitForRequest(
		(req) => req.url().endsWith("/api/games") && req.method() === "POST",
	);
	await createButton.click();
	const createRequest = await createRequestPromise;
	const body = createRequest.postDataJSON();

	// 5. Verify API received correct payload (5 min = 300 seconds)
	expect(body).toMatchObject({
		gameType: "chess",
		playerWhiteAddress: MOCK_FREIGHTER_ADDRESS,
		timeControlSeconds: 300,
	});

	// 6. Verify Share Match modal appears with shareable link
	await expect(page.getByRole("heading", { name: "Share Match Link" })).toBeVisible();
	await expect(page.getByText(new RegExp(createdGameCode))).toBeVisible();

	// 7. Verify clipboard copy action
	const copyButton = page.getByRole("button", { name: "Copy" });
	await expect(copyButton).toBeVisible();
	await copyButton.click();
	await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();

	const clipboardContent = await page.evaluate(() => navigator.clipboard.readText());
	expect(clipboardContent).toContain(createdGameCode);

	// 8. Continue to game
	await page.getByRole("button", { name: "Continue to Game" }).click();
	await expect(page).toHaveURL(new RegExp(`/${createdGameCode}$`));
});

