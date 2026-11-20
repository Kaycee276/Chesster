const {
	registerPremove,
	checkMoveTiming,
	recordMoveCompleted,
	clearMoveTimingState,
	MOVE_BURST_MIN_DELTA_MS,
	PREMOVE_MIN_TURN_MS,
	RATE_LIMITED_MOVE_BURST,
	INVALID_PREMOVE,
} = require("../socket/moveAuthority");
const { AntiCheatService } = require("../services/antiCheatService");

const GAME = "BURST1";

afterEach(() => clearMoveTimingState(GAME));

describe("move burst detection (#583)", () => {
	it("accepts the first move of a game", () => {
		expect(checkMoveTiming(GAME, "white", { now: 1000 }).ok).toBe(true);
	});

	it("accepts standard moves at or beyond 40ms", () => {
		recordMoveCompleted(GAME, "white", 1000);
		const atLimit = checkMoveTiming(GAME, "black", { now: 1000 + MOVE_BURST_MIN_DELTA_MS });
		expect(atLimit.ok).toBe(true);
		expect(checkMoveTiming(GAME, "black", { now: 3500 }).ok).toBe(true);
	});

	it("rejects non-premove moves under 40ms with RATE_LIMITED_MOVE_BURST", () => {
		recordMoveCompleted(GAME, "white", 1000);
		const result = checkMoveTiming(GAME, "black", { now: 1039 });
		expect(result).toMatchObject({ ok: false, code: RATE_LIMITED_MOVE_BURST, deltaMs: 39 });
	});

	it("rejects a burst of rapid sequential moves", () => {
		recordMoveCompleted(GAME, "white", 1000);
		expect(checkMoveTiming(GAME, "black", { now: 1005 }).code).toBe(RATE_LIMITED_MOVE_BURST);
		expect(checkMoveTiming(GAME, "black", { now: 1010 }).code).toBe(RATE_LIMITED_MOVE_BURST);
	});
});

describe("premove validation (#583)", () => {
	it("accepts a premove registered before the opponent move and clamps duration to 10ms", () => {
		registerPremove(GAME, "black", 900);
		recordMoveCompleted(GAME, "white", 1000);
		const result = checkMoveTiming(GAME, "black", { isPremove: true, now: 1002 });
		expect(result.ok).toBe(true);
		expect(result.deltaMs).toBe(2);
		expect(result.effectiveDeltaMs).toBe(PREMOVE_MIN_TURN_MS);
	});

	it("does not clamp premoves that already exceed 10ms", () => {
		registerPremove(GAME, "black", 900);
		recordMoveCompleted(GAME, "white", 1000);
		expect(checkMoveTiming(GAME, "black", { isPremove: true, now: 1030 }).effectiveDeltaMs).toBe(30);
	});

	it("rejects a forged premove flag with no registration", () => {
		recordMoveCompleted(GAME, "white", 1000);
		expect(checkMoveTiming(GAME, "black", { isPremove: true, now: 1001 })).toMatchObject({
			ok: false,
			code: INVALID_PREMOVE,
		});
	});

	it("rejects a premove registered after the opponent move landed", () => {
		recordMoveCompleted(GAME, "white", 1000);
		registerPremove(GAME, "black", 1001);
		expect(checkMoveTiming(GAME, "black", { isPremove: true, now: 1002 }).code).toBe(INVALID_PREMOVE);
	});

	it("rejects a premove flag on the first move (nothing to premove against)", () => {
		registerPremove(GAME, "black", 900);
		expect(checkMoveTiming(GAME, "black", { isPremove: true, now: 1000 }).ok).toBe(false);
	});

	it("consumes the premove once the player's move completes", () => {
		registerPremove(GAME, "black", 900);
		recordMoveCompleted(GAME, "white", 1000);
		recordMoveCompleted(GAME, "black", 1002);
		recordMoveCompleted(GAME, "white", 2000);
		expect(checkMoveTiming(GAME, "black", { isPremove: true, now: 2001 }).code).toBe(INVALID_PREMOVE);
	});

	it("keeps premoves of different colors independent", () => {
		registerPremove(GAME, "white", 900);
		recordMoveCompleted(GAME, "white", 1000);
		expect(checkMoveTiming(GAME, "black", { isPremove: true, now: 1002 }).code).toBe(INVALID_PREMOVE);
	});
});

describe("burst telemetry (#583)", () => {
	function build(insert) {
		const logger = { warn: jest.fn() };
		const db = { from: jest.fn(() => ({ insert })) };
		return { service: new AntiCheatService({ db, logger }), db, logger };
	}

	it("logs gameCode, wallet, ip, delta and reason to anti_cheat_logs", async () => {
		const insert = jest.fn().mockResolvedValue({ error: null });
		const { service, db } = build(insert);
		const ok = await service.logMoveBurst({
			gameCode: GAME,
			walletAddress: "GBLACK",
			ip: "10.0.0.1",
			deltaMs: 12.4,
			reason: RATE_LIMITED_MOVE_BURST,
		});
		expect(ok).toBe(true);
		expect(db.from).toHaveBeenCalledWith("anti_cheat_logs");
		expect(insert).toHaveBeenCalledWith({
			game_code: GAME,
			wallet_address: "GBLACK",
			ip_address: "10.0.0.1",
			delta_ms: 12,
			reason: RATE_LIMITED_MOVE_BURST,
		});
	});

	it("never throws when the insert fails", async () => {
		const { service, logger } = build(jest.fn().mockResolvedValue({ error: new Error("db down") }));
		await expect(service.logMoveBurst({ gameCode: GAME, deltaMs: 1, reason: INVALID_PREMOVE })).resolves.toBe(false);
		expect(logger.warn).toHaveBeenCalled();
	});
});
