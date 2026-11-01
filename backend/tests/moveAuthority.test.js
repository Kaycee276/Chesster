process.env.JWT_SECRET = "test-secret";

const jwt = require("jsonwebtoken");
const {
	verifySocketToken,
	resolvePlayerColor,
	authorizeMove,
	handleDisconnect,
	handleReconnect,
	reconcileGameState,
} = require("../socket/moveAuthority");

const WHITE = "GWHITEADDRESS";
const BLACK = "GBLACKADDRESS";

function tokenFor(address, opts = {}) {
	return jwt.sign({ address }, "test-secret", opts);
}

const activeGame = {
	status: "active",
	current_turn: "white",
	player_white_address: WHITE,
	player_black_address: BLACK,
};

describe("verifySocketToken", () => {
	it("returns claims for a valid token", () => {
		const claims = verifySocketToken(tokenFor(WHITE));
		expect(claims).toMatchObject({ address: WHITE });
	});

	it("returns null for a missing token", () => {
		expect(verifySocketToken(undefined)).toBeNull();
		expect(verifySocketToken(null)).toBeNull();
		expect(verifySocketToken("")).toBeNull();
	});

	it("returns null for a token signed with the wrong secret (forgery)", () => {
		const forged = jwt.sign({ address: WHITE }, "attacker-secret");
		expect(verifySocketToken(forged)).toBeNull();
	});

	it("returns null for an expired token", () => {
		const expired = tokenFor(WHITE, { expiresIn: -10 });
		expect(verifySocketToken(expired)).toBeNull();
	});
});

describe("resolvePlayerColor", () => {
	it("maps the registered wallet to its color", () => {
		expect(resolvePlayerColor(activeGame, WHITE)).toBe("white");
		expect(resolvePlayerColor(activeGame, BLACK)).toBe("black");
	});

	it("returns null for a wallet that is not a player (spectator)", () => {
		expect(resolvePlayerColor(activeGame, "GRANDOMSPECTATOR")).toBeNull();
	});

	it("returns null on missing input", () => {
		expect(resolvePlayerColor(null, WHITE)).toBeNull();
		expect(resolvePlayerColor(activeGame, null)).toBeNull();
	});
});

describe("authorizeMove", () => {
	it("allows the player whose turn it is", () => {
		expect(authorizeMove(activeGame, "white")).toEqual({ ok: true });
	});

	it("rejects a spectator (no bound color) - blocks socket injection", () => {
		const res = authorizeMove(activeGame, null);
		expect(res.ok).toBe(false);
		expect(res.code).toBe("not-a-player");
	});

	it("rejects a move made out of turn - blocks move spoofing", () => {
		const res = authorizeMove(activeGame, "black");
		expect(res.ok).toBe(false);
		expect(res.code).toBe("not-your-turn");
	});

	it("rejects moves when the game is not active", () => {
		const res = authorizeMove({ ...activeGame, status: "finished" }, "white");
		expect(res.ok).toBe(false);
		expect(res.code).toBe("game-not-active");
	});

	it("rejects when the game is missing", () => {
		const res = authorizeMove(null, "white");
		expect(res.ok).toBe(false);
		expect(res.code).toBe("game-not-found");
	});
});

describe("exploit simulation: forged color binding", () => {
	it("does not grant a color to a spectator presenting a valid token for a game they are not in", () => {
		// A spectator authenticates with their own (valid) token, then tries to
		// join as white. resolvePlayerColor derives the color from server-owned
		// game state, so the spectator resolves to null and is never bound.
		const claims = verifySocketToken(tokenFor("GSPECTATOR"));
		expect(claims).not.toBeNull();
		const boundColor = resolvePlayerColor(activeGame, claims.address);
		expect(boundColor).toBeNull();
		// With no bound color, any move they emit is rejected.
		expect(authorizeMove(activeGame, boundColor).ok).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Issue #434: adaptive reconnect / state-reconciliation helpers
// ---------------------------------------------------------------------------

describe("handleDisconnect", () => {
	it("starts the grace period for a disconnect during an active game", async () => {
		const gameModel = { getGame: jest.fn().mockResolvedValue(activeGame) };
		const result = await handleDisconnect({ gameModel }, "GAME1", "white");
		expect(result).toEqual({ shouldStartGrace: true, game: activeGame });
	});

	it("does not start the grace period when the game is not active", async () => {
		const finishedGame = { ...activeGame, status: "finished" };
		const gameModel = { getGame: jest.fn().mockResolvedValue(finishedGame) };
		const result = await handleDisconnect({ gameModel }, "GAME1", "white");
		expect(result.shouldStartGrace).toBe(false);
	});

	it("does not start the grace period when the game cannot be found", async () => {
		const gameModel = { getGame: jest.fn().mockRejectedValue(new Error("not found")) };
		const result = await handleDisconnect({ gameModel }, "GAME1", "white");
		expect(result).toEqual({ shouldStartGrace: false });
	});

	it("is a no-op when gameCode or playerColor is missing", async () => {
		const gameModel = { getGame: jest.fn() };
		expect(await handleDisconnect({ gameModel }, null, "white")).toEqual({ shouldStartGrace: false });
		expect(await handleDisconnect({ gameModel }, "GAME1", null)).toEqual({ shouldStartGrace: false });
		expect(gameModel.getGame).not.toHaveBeenCalled();
	});
});

describe("handleReconnect", () => {
	it("authorizes a registered player and cancels their pending grace timer", async () => {
		const gameModel = { getGame: jest.fn().mockResolvedValue(activeGame) };
		const timerService = { cancelReconnectGrace: jest.fn() };

		const result = await handleReconnect({ gameModel, timerService }, "GAME1", WHITE);

		expect(result).toEqual({ ok: true, game: activeGame, playerColor: "white" });
		expect(timerService.cancelReconnectGrace).toHaveBeenCalledWith("GAME1", "white");
	});

	it("rejects a wallet that is not a participant in the game", async () => {
		const gameModel = { getGame: jest.fn().mockResolvedValue(activeGame) };
		const timerService = { cancelReconnectGrace: jest.fn() };

		const result = await handleReconnect({ gameModel, timerService }, "GAME1", "GOUTSIDER");

		expect(result.ok).toBe(false);
		expect(result.code).toBe("not-a-player");
		expect(timerService.cancelReconnectGrace).not.toHaveBeenCalled();
	});

	it("rejects reconnecting to a non-active game", async () => {
		const finishedGame = { ...activeGame, status: "finished" };
		const gameModel = { getGame: jest.fn().mockResolvedValue(finishedGame) };
		const timerService = { cancelReconnectGrace: jest.fn() };

		const result = await handleReconnect({ gameModel, timerService }, "GAME1", WHITE);

		expect(result.ok).toBe(false);
		expect(result.code).toBe("game-not-active");
	});

	it("rejects when the game cannot be found", async () => {
		const gameModel = { getGame: jest.fn().mockRejectedValue(new Error("not found")) };
		const timerService = { cancelReconnectGrace: jest.fn() };

		const result = await handleReconnect({ gameModel, timerService }, "MISSING", WHITE);

		expect(result).toEqual({ ok: false, code: "game-not-found", message: "Game not found" });
	});
});

describe("reconcileGameState", () => {
	const game = {
		...activeGame,
		board_state: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
		draw_offer: null,
		in_check: false,
		last_move: { from: "e2", to: "e4" },
	};
	const moves = [
		{ move_number: 0, from_position: "e2", to_position: "e4", piece: "p", promotion: null },
		{ move_number: 1, from_position: "e7", to_position: "e5", piece: "p", promotion: null },
		{ move_number: 2, from_position: "g1", to_position: "f3", piece: "n", promotion: null },
	];

	it("returns null when the game does not exist", async () => {
		const gameController = { getGameStateSnapshot: jest.fn().mockResolvedValue(null) };
		const timerService = { getPreciseClocks: jest.fn() };

		const result = await reconcileGameState({ gameController, timerService }, "MISSING", -1, "white");
		expect(result).toBeNull();
	});

	it("returns only the moves after lastKnownMoveIndex, tagged with their moveSeq", async () => {
		const gameController = { getGameStateSnapshot: jest.fn().mockResolvedValue({ game, moves }) };
		const timerService = {
			getPreciseClocks: jest.fn().mockReturnValue({ whiteMs: 59000, blackMs: 60000, incrementMs: 0, preset: "rapid" }),
		};

		const result = await reconcileGameState({ gameController, timerService }, "GAME1", 0, "white");

		expect(result.missedMoves).toEqual([
			{ moveSeq: 1, from: "e7", to: "e5", piece: "p", promotion: null },
			{ moveSeq: 2, from: "g1", to: "f3", piece: "n", promotion: null },
		]);
		expect(result.lastMoveSeq).toBe(2);
		expect(result.whiteTimeMs).toBe(59000);
		expect(result.blackTimeMs).toBe(60000);
		expect(result.currentTurn).toBe("white");
		expect(result.fen).toBe(game.board_state);
	});

	it("returns the full move list when the client reports no known moves", async () => {
		const gameController = { getGameStateSnapshot: jest.fn().mockResolvedValue({ game, moves }) };
		const timerService = { getPreciseClocks: jest.fn().mockReturnValue(null) };

		const result = await reconcileGameState({ gameController, timerService }, "GAME1", -1, "white");

		expect(result.missedMoves).toHaveLength(3);
		expect(result.whiteTimeMs).toBeNull();
		expect(result.blackTimeMs).toBeNull();
	});

	it("returns no missed moves and the correct lastMoveSeq when fully caught up", async () => {
		const gameController = { getGameStateSnapshot: jest.fn().mockResolvedValue({ game, moves }) };
		const timerService = { getPreciseClocks: jest.fn().mockReturnValue(null) };

		const result = await reconcileGameState({ gameController, timerService }, "GAME1", 2, "white");

		expect(result.missedMoves).toEqual([]);
		expect(result.lastMoveSeq).toBe(2);
	});

	it("masks the FEN for fog-of-war/blindfold variants via chessEngine", async () => {
		const maskedGame = { ...game, variant: "fog_of_war" };
		const gameController = { getGameStateSnapshot: jest.fn().mockResolvedValue({ game: maskedGame, moves: [] }) };
		const timerService = { getPreciseClocks: jest.fn().mockReturnValue(null) };
		const chessEngine = { generateFogOfWarFen: jest.fn().mockReturnValue("MASKED_FEN") };

		const result = await reconcileGameState({ gameController, timerService, chessEngine }, "GAME1", -1, "white");

		expect(chessEngine.generateFogOfWarFen).toHaveBeenCalledWith(maskedGame.board_state, "white", maskedGame.current_turn);
		expect(result.fen).toBe("MASKED_FEN");
	});
});
