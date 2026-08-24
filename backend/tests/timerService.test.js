process.env.SUPABASE_URL = "http://localhost";
process.env.SUPABASE_ANON_KEY = "test-key";

jest.mock("../models/gameModel", () => ({
	endByFlag: jest.fn().mockResolvedValue({ game_code: "GAME123", status: "finished", winner: "black" }),
	forfeitByDisconnect: jest.fn().mockResolvedValue({ game_code: "GAME123", status: "finished", winner: "black" }),
}));

const timerService = require("../services/timerService");
const gameModel = require("../models/gameModel");

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
