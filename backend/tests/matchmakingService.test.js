const matchmakingService = require("../services/matchmakingService");

describe("MatchmakingService", () => {
	beforeEach(() => {
		matchmakingService.clearQueue();
	});

	describe("addToQueue", () => {
		test("adds a valid player to the queue", () => {
			const entry = matchmakingService.addToQueue({
				userId: "user-1",
				socketId: "socket-1",
				elo: 1500,
				wagerTier: "low",
			});

			expect(entry).toEqual({
				userId: "user-1",
				socketId: "socket-1",
				elo: 1500,
				wagerTier: "low",
				joinedAt: expect.any(Number),
			});
			expect(matchmakingService.getQueueSize()).toBe(1);
		});

		test("defaults Elo to 1200 if omitted or invalid", () => {
			const entry = matchmakingService.addToQueue({
				userId: "user-2",
				socketId: "socket-2",
				wagerTier: "free",
			});

			expect(entry.elo).toBe(1200);
		});

		test("throws an error if userId or socketId is missing", () => {
			expect(() => {
				matchmakingService.addToQueue({ socketId: "socket-1" });
			}).toThrow("userId is required for matchmaking");

			expect(() => {
				matchmakingService.addToQueue({ userId: "user-1" });
			}).toThrow("socketId is required for matchmaking");
		});
	});

	describe("removeFromQueue & removeFromQueueBySocket", () => {
		test("removes player by userId", () => {
			matchmakingService.addToQueue({
				userId: "user-1",
				socketId: "socket-1",
				elo: 1400,
			});

			const removed = matchmakingService.removeFromQueue("user-1");
			expect(removed).toBe(true);
			expect(matchmakingService.getQueueSize()).toBe(0);
		});

		test("returns false when removing non-existent user", () => {
			expect(matchmakingService.removeFromQueue("non-existent")).toBe(false);
		});

		test("removes player by socketId", () => {
			matchmakingService.addToQueue({
				userId: "user-1",
				socketId: "socket-1",
				elo: 1400,
			});

			const removed = matchmakingService.removeFromQueueBySocket("socket-1");
			expect(removed).toBe(true);
			expect(matchmakingService.getQueueSize()).toBe(0);
		});
	});

	describe("findMatch", () => {
		test("pairs players with matching wager tier and comparable Elo", () => {
			matchmakingService.addToQueue({
				userId: "user-1",
				socketId: "socket-1",
				elo: 1500,
				wagerTier: "medium",
			});

			matchmakingService.addToQueue({
				userId: "user-2",
				socketId: "socket-2",
				elo: 1530,
				wagerTier: "medium",
			});

			const match = matchmakingService.findMatch({
				userId: "user-1",
				elo: 1500,
				wagerTier: "medium",
			});

			expect(match).not.toBeNull();
			expect(match.player1.userId).toBe("user-1");
			expect(match.player2.userId).toBe("user-2");
			expect(matchmakingService.getQueueSize()).toBe(0);
		});

		test("does not pair players across different wager tiers", () => {
			matchmakingService.addToQueue({
				userId: "user-1",
				socketId: "socket-1",
				elo: 1500,
				wagerTier: "low",
			});

			matchmakingService.addToQueue({
				userId: "user-2",
				socketId: "socket-2",
				elo: 1500,
				wagerTier: "high",
			});

			const match = matchmakingService.findMatch({
				userId: "user-1",
				elo: 1500,
				wagerTier: "low",
			});

			expect(match).toBeNull();
			expect(matchmakingService.getQueueSize()).toBe(2);
		});

		test("does not pair players when Elo gap exceeds threshold", () => {
			matchmakingService.addToQueue({
				userId: "user-1",
				socketId: "socket-1",
				elo: 1200,
				wagerTier: "free",
			});

			matchmakingService.addToQueue({
				userId: "user-2",
				socketId: "socket-2",
				elo: 1600,
				wagerTier: "free",
			});

			const match = matchmakingService.findMatch({
				userId: "user-1",
				elo: 1200,
				wagerTier: "free",
			});

			expect(match).toBeNull();
		});

		test("expands Elo tolerance dynamically as wait time increases", () => {
			const pastTime = Date.now() - 30000; // 30 seconds ago
			jest.spyOn(Date, "now").mockReturnValue(pastTime);

			matchmakingService.addToQueue({
				userId: "user-1",
				socketId: "socket-1",
				elo: 1200,
				wagerTier: "free",
			});

			// Advance time by 30 seconds -> 10 pts/sec expansion -> maxEloDiff becomes 100 + 300 = 400
			jest.spyOn(Date, "now").mockReturnValue(pastTime + 30000);

			matchmakingService.addToQueue({
				userId: "user-2",
				socketId: "socket-2",
				elo: 1450,
				wagerTier: "free",
			});

			const match = matchmakingService.findMatch({
				userId: "user-1",
				elo: 1200,
				wagerTier: "free",
				joinedAt: pastTime,
			});

			expect(match).not.toBeNull();
			expect(match.player1.userId).toBe("user-1");
			expect(match.player2.userId).toBe("user-2");

			jest.restoreAllMocks();
		});
	});

	describe("processQueue", () => {
		test("pairs all eligible players in the queue", () => {
			matchmakingService.addToQueue({ userId: "u1", socketId: "s1", elo: 1200, wagerTier: "free" });
			matchmakingService.addToQueue({ userId: "u2", socketId: "s2", elo: 1210, wagerTier: "free" });
			matchmakingService.addToQueue({ userId: "u3", socketId: "s3", elo: 1800, wagerTier: "high" });
			matchmakingService.addToQueue({ userId: "u4", socketId: "s4", elo: 1820, wagerTier: "high" });

			const matches = matchmakingService.processQueue();
			expect(matches.length).toBe(2);
			expect(matchmakingService.getQueueSize()).toBe(0);
		});
	});

	describe("getQueueStatus & getQueueSize", () => {
		test("returns correct status and queue sizes", () => {
			matchmakingService.addToQueue({ userId: "u1", socketId: "s1", elo: 1200, wagerTier: "free" });
			matchmakingService.addToQueue({ userId: "u2", socketId: "s2", elo: 1400, wagerTier: "high" });

			expect(matchmakingService.getQueueSize()).toBe(2);
			expect(matchmakingService.getQueueSize("free")).toBe(1);
			expect(matchmakingService.getQueueSize("high")).toBe(1);

			const status = matchmakingService.getQueueStatus("u1");
			expect(status).not.toBeNull();
			expect(status.userId).toBe("u1");
			expect(status.waitTimeSeconds).toBeGreaterThanOrEqual(0);
		});
	});
});
