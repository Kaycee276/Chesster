process.env.JWT_SECRET = "test-secret";

const jwt = require("jsonwebtoken");
const {
	verifySocketToken,
	resolvePlayerColor,
	authorizeMove,
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
