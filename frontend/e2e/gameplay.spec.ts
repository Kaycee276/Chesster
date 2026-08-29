import { expect, test, type BrowserContext, type Page } from "@playwright/test";

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
