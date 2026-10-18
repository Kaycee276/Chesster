process.env.SUPABASE_URL = "http://localhost";
process.env.SUPABASE_ANON_KEY = "test-key";

jest.mock("../models/gameModel", () => ({
	endByFlag: jest.fn().mockResolvedValue({ game_code: "GAME123", status: "finished", winner: "black" }),
	forfeitByDisconnect: jest.fn().mockResolvedValue({ game_code: "GAME123", status: "finished", winner: "black" }),
}));
jest.mock("../models/userModel", () => ({ invalidateProfilesForGame: jest.fn().mockResolvedValue(undefined) }));

const timerService = require("../services/timerService");
const gameModel = require("../models/gameModel");
const userModel = require("../models/userModel");

describe("TimerService", () => {
	let mockIo;

	beforeEach(() => {
		jest.useFakeTimers();
		mockIo = { to: jest.fn().mockReturnThis(), emit: jest.fn() };
		timerService.init(mockIo);
	});

	afterEach(() => {
		// Clear any lingering timers between tests.
		timerService.clocks.forEach((_, code) => timerService.clearClock(code));
		timerService.reconnectTimers.forEach((_, key) => {
			const [gameCode, color] = key.split(":");
			timerService.cancelReconnectGrace(gameCode, color);
		});
		jest.clearAllMocks();
		jest.useRealTimers();
	});

	describe("clocks / time controls", () => {
		it("exposes bullet/blitz/rapid presets", () => {
			const presets = timerService.getTimeControls();
			expect(presets.bullet.baseSeconds).toBe(60);
			expect(presets.blitz.baseSeconds).toBe(180);
			expect(presets.blitz.incrementSeconds).toBe(2);
			expect(presets.rapid.baseSeconds).toBe(600);
		});

		it("starts a clock with equal time for both players", () => {
			const state = timerService.startClock("GAME123", { preset: "blitz", turn: "white" });
			expect(state.whiteMs).toBe(180000);
			expect(state.blackMs).toBe(180000);
			expect(state.turn).toBe("white");
		});

		it("applies the Fischer increment to the mover after a move", () => {
			timerService.startClock("GAME123", { baseSeconds: 60, incrementSeconds: 5, turn: "white" });

			jest.advanceTimersByTime(3000); // white "thinks" for 3s
			const state = timerService.applyMove("GAME123", "white");

			// white spent ~3s but gained a 5s increment, so should be up net ~2s
			expect(state.whiteMs).toBeGreaterThan(60000);
			expect(state.turn).toBe("black");
		});

		it("declares the flag-fall loser when a player's clock hits zero", async () => {
			timerService.startClock("GAME123", { baseSeconds: 1, incrementSeconds: 0, turn: "white" });

			await jest.advanceTimersByTimeAsync(1100);

			expect(gameModel.endByFlag).toHaveBeenCalledWith("GAME123", "white");
			expect(userModel.invalidateProfilesForGame).toHaveBeenCalledWith(expect.objectContaining({ status: "finished" }));
			expect(mockIo.to).toHaveBeenCalledWith("GAME123");
			expect(mockIo.emit).toHaveBeenCalledWith("game-update", expect.any(Object));
		});

		it("clearClock stops a pending flag-fall", async () => {
			timerService.startClock("GAME123", { baseSeconds: 1, incrementSeconds: 0, turn: "white" });
			timerService.clearClock("GAME123");

			await jest.advanceTimersByTimeAsync(1500);

			expect(gameModel.endByFlag).not.toHaveBeenCalled();
		});
	});

	describe("reconnect grace period", () => {
		it("auto-forfeits after the grace period elapses without reconnect", async () => {
			timerService.startReconnectGrace("GAME123", "black", 1);

			expect(timerService.isPendingForfeit("GAME123", "black")).toBe(true);

			await jest.advanceTimersByTimeAsync(1100);

			expect(gameModel.forfeitByDisconnect).toHaveBeenCalledWith("GAME123", "black");
			expect(userModel.invalidateProfilesForGame).toHaveBeenCalledWith(expect.objectContaining({ status: "finished" }));
			expect(timerService.isPendingForfeit("GAME123", "black")).toBe(false);
		});

		it("cancelling the grace period prevents the auto-forfeit", async () => {
			timerService.startReconnectGrace("GAME123", "black", 1);
			const cancelled = timerService.cancelReconnectGrace("GAME123", "black");

			expect(cancelled).toBe(true);

			await jest.advanceTimersByTimeAsync(1500);

			expect(gameModel.forfeitByDisconnect).not.toHaveBeenCalled();
		});
	});
});

describe("TimerService monotonic clock precision (Issue #462)", () => {
	const { TimerService } = timerService;
	const MS = 1_000_000n;

	/** Controllable monotonic clock in bigint nanoseconds. */
	function fakeHrClock(startMs = 1_000) {
		let nowNs = BigInt(startMs) * MS;
		const hrNow = () => nowNs;
		hrNow.advance = (ms) => { nowNs += BigInt(ms) * MS; };
		hrNow.advanceNs = (ns) => { nowNs += BigInt(ns); };
		return hrNow;
	}

	let service;
	let hrNow;
	let io;

	beforeEach(() => {
		jest.useFakeTimers();
		hrNow = fakeHrClock();
		service = new TimerService({ hrNow });
		io = { to: jest.fn().mockReturnThis(), emit: jest.fn() };
		service.init(io);
	});

	afterEach(() => {
		service.clocks.forEach((_, code) => service.clearClock(code));
		service.timers.forEach((_, code) => service.clearTimer(code));
		jest.clearAllMocks();
		jest.useRealTimers();
	});

	const timerSyncCalls = () => io.emit.mock.calls.filter(([event]) => event === "timer_sync").map(([, payload]) => payload);

	it("derives remaining time from process.hrtime.bigint() by default", () => {
		const spy = jest.spyOn(process.hrtime, "bigint");
		const realService = new TimerService();
		realService.startClock("HR", { preset: "blitz" });
		realService.getClockState("HR");
		realService.clearClock("HR");

		expect(spy).toHaveBeenCalled();
		spy.mockRestore();
	});

	it("computes remaining = allocated - floor((now - turnStart) / 1e6) with no tick accumulation", () => {
		service.startClock("G", { baseSeconds: 60, incrementSeconds: 0 });

		hrNow.advanceNs(12_345_999_999n); // 12345.999999ms elapsed -> floor to 12345ms
		expect(service.getClockState("G").whiteMs).toBe(60_000 - 12_345);
		expect(service.getClockState("G").blackMs).toBe(60_000);
	});

	it("keeps clocks exact when the event loop stalls and timers fire late", () => {
		service.startClock("G", { baseSeconds: 180, incrementSeconds: 2 });

		// 4.2s of thinking, but the event loop was blocked and no timer ran.
		hrNow.advance(4_200);
		const afterWhite = service.applyMove("G", "white");
		expect(afterWhite.whiteMs).toBe(180_000 - 4_200 + 2_000);

		hrNow.advance(7_777);
		const afterBlack = service.applyMove("G", "black");
		expect(afterBlack.blackMs).toBe(180_000 - 7_777 + 2_000);
		expect(afterBlack.whiteMs).toBe(177_800);
	});

	it("stays within 50ms of true elapsed time under a real blocked event loop", async () => {
		jest.useRealTimers();
		const realService = new TimerService();
		const startedAt = process.hrtime.bigint();
		realService.startClock("REAL", { baseSeconds: 60, incrementSeconds: 0 });

		// Block the event loop (simulated CPU spike), then let a few timers run.
		const blockUntil = Date.now() + 250;
		while (Date.now() < blockUntil) { /* busy wait */ }
		await new Promise((resolve) => setTimeout(resolve, 30));

		const trueElapsedMs = Number((process.hrtime.bigint() - startedAt) / MS);
		const { whiteMs } = realService.getClockState("REAL");
		realService.clearClock("REAL");

		expect(Math.abs((60_000 - whiteMs) - trueElapsedMs)).toBeLessThan(50);
	});

	it("does not flag a player when the flag timer fires before their time is actually up", async () => {
		service.startClock("G", { baseSeconds: 1, incrementSeconds: 0 });

		// The setTimeout fires at 1000ms, but only 900ms of monotonic time passed.
		hrNow.advance(900);
		await jest.advanceTimersByTimeAsync(1_000);
		expect(gameModel.endByFlag).not.toHaveBeenCalled();
		expect(service.getClockState("G").whiteMs).toBe(100);

		hrNow.advance(100);
		await jest.advanceTimersByTimeAsync(100);
		expect(gameModel.endByFlag).toHaveBeenCalledWith("G", "white");
		expect(timerSyncCalls().at(-1)).toMatchObject({ whiteTimeMs: 0, blackTimeMs: 1_000 });
	});

	it("flags a move that arrives after time expired instead of granting the increment", async () => {
		service.startClock("G", { baseSeconds: 5, incrementSeconds: 3 });

		// Flag-fall timer delayed by congestion; the move arrives at 5.4s.
		hrNow.advance(5_400);
		const clock = service.applyMove("G", "white");

		expect(clock.whiteMs).toBe(0);
		expect(clock.turn).toBe("white");
		await jest.advanceTimersByTimeAsync(0);
		expect(gameModel.endByFlag).toHaveBeenCalledWith("G", "white");
		expect(service.clocks.has("G")).toBe(false);
	});

	it("banks the elapsed slice on pause and resumes from the same remaining time", async () => {
		service.startClock("G", { baseSeconds: 60, incrementSeconds: 0 });
		hrNow.advance(10_000);

		expect(service.pauseClock("G")).toMatchObject({ whiteMs: 50_000, paused: true });

		// A long pause (e.g. disconnection grace) consumes no clock time and
		// cannot trigger a flag fall.
		hrNow.advance(120_000);
		await jest.advanceTimersByTimeAsync(120_000);
		expect(service.getClockState("G").whiteMs).toBe(50_000);
		expect(gameModel.endByFlag).not.toHaveBeenCalled();

		service.resumeClock("G");
		hrNow.advance(2_500);
		expect(service.getClockState("G")).toMatchObject({ whiteMs: 47_500, paused: false });
	});

	it("applies the increment to a move made while paused without consuming time", () => {
		service.startClock("G", { baseSeconds: 60, incrementSeconds: 2 });
		hrNow.advance(1_000);
		service.pauseClock("G");
		hrNow.advance(30_000);

		const clock = service.applyMove("G", "white");
		expect(clock).toMatchObject({ whiteMs: 61_000, blackMs: 60_000, turn: "black", paused: true });

		hrNow.advance(5_000);
		expect(service.getClockState("G").blackMs).toBe(60_000);
	});

	it("broadcasts timer_sync with both clocks and a server timestamp on start and every move", () => {
		jest.setSystemTime(new Date("2026-10-17T12:00:00.000Z"));
		service.startClock("G", { baseSeconds: 120, incrementSeconds: 1 });
		hrNow.advance(3_000);
		service.applyMove("G", "white");

		const syncs = timerSyncCalls();
		expect(io.to).toHaveBeenCalledWith("G");
		expect(syncs).toHaveLength(2);
		expect(syncs[1]).toEqual({
			gameCode: "G",
			whiteTimeMs: 118_000,
			blackTimeMs: 120_000,
			turn: "black",
			paused: false,
			serverTimestamp: Date.parse("2026-10-17T12:00:00.000Z"),
		});
	});

	it("re-anchors deadline-only clock states onto the monotonic clock", () => {
		jest.setSystemTime(10_000);
		service.clocks.set("LEGACY", {
			whiteMs: 600_000,
			blackMs: 600_000,
			incrementMs: 0,
			preset: "rapid",
			turn: "white",
			deadline: 10_000 + 30_000,
			timeout: null,
		});

		expect(service.getPreciseClocks("LEGACY").whiteMs).toBe(30_000);
		hrNow.advance(1_000);
		expect(service.getPreciseClocks("LEGACY").whiteMs).toBe(29_000);
	});

	it("ends the legacy shared countdown from the monotonic anchor, not by counting ticks", async () => {
		gameModel.endByTime = jest.fn().mockResolvedValue({ game_code: "G", status: "finished" });
		service.startTimer("G", 3);

		// Three interval ticks run, but the loop was stalled and only 1.5s passed.
		hrNow.advance(1_500);
		await jest.advanceTimersByTimeAsync(3_000);
		expect(gameModel.endByTime).not.toHaveBeenCalled();
		expect(service.timers.get("G").remainingMs()).toBe(1_500);

		hrNow.advance(1_500);
		await jest.advanceTimersByTimeAsync(1_000);
		expect(gameModel.endByTime).toHaveBeenCalledWith("G");
		expect(service.timers.has("G")).toBe(false);
	});
});
