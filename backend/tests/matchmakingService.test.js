const matchmakingService = require("../services/matchmakingService");
const { MatchmakingService, getPlayerTolerance, getEligibleRatingDelta, MATCHMAKING_CONFIG } = matchmakingService;

describe("MatchmakingService", () => {
	beforeEach(() => {
		matchmakingService.clearQueue();
	});

	describe("getEligibleRatingDelta", () => {
		test.each([
			[0, 50],
			[9.999, 50],
			[10, 100],
			[10.001, 100],
			[24.999, 100],
			[25, 200],
			[25.001, 200],
			[44.999, 200],
			[45, 400],
			[45.001, 400],
			[100, 400],
			[3600, 400],
		])("at %ss of wait time returns ±%i", (waitSec, expected) => {
			expect(getEligibleRatingDelta(waitSec)).toBe(expected);
		});

		test("respects exact boundaries: 10s is in the 100 bracket", () => {
			expect(getEligibleRatingDelta(10)).toBe(100);
			expect(getEligibleRatingDelta(9.999)).toBe(50);
		});

		test("respects exact boundaries: 25s is in the 200 bracket", () => {
			expect(getEligibleRatingDelta(25)).toBe(200);
			expect(getEligibleRatingDelta(24.999)).toBe(100);
		});

		test("respects exact boundaries: 45s is in the 400 bracket", () => {
			expect(getEligibleRatingDelta(45)).toBe(400);
			expect(getEligibleRatingDelta(44.999)).toBe(200);
		});
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
				queuedAt: expect.any(Number),
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

	describe("dynamic Elo bucket expansion", () => {
		const T0 = 1_700_000_000_000;
		const sec = (s) => T0 + s * 1000;
		let service;

		// Queue a player as if they joined `secondsAgo` seconds before `now`.
		function queueAt(userId, elo, joinedAtSec, wagerTier = "free") {
			jest.spyOn(Date, "now").mockReturnValue(sec(joinedAtSec));
			const entry = service.addToQueue({ userId, socketId: `socket-${userId}`, elo, wagerTier });
			jest.restoreAllMocks();
			return entry;
		}

		beforeEach(() => {
			service = new MatchmakingService();
		});

		afterEach(() => {
			service.stopQueueWorker();
			jest.restoreAllMocks();
			jest.useRealTimers();
		});

		describe("getPlayerTolerance", () => {
			test.each([
				[0, 50],
				[9.999, 50],
				[10, 100],
				[24.999, 100],
				[25, 200],
				[44.999, 200],
				[45, 400],
				[100, 400],
				[3600, 400],
			])("after %ss of waiting the tolerance is ±%i", (waitSec, expected) => {
				expect(getPlayerTolerance({ queuedAt: T0 }, sec(waitSec))).toBe(expected);
			});

			test("never drops below the base tolerance for clock skew", () => {
				expect(getPlayerTolerance({ queuedAt: sec(10) }, T0)).toBe(50);
			});

			test("exposes the expansion configuration", () => {
				expect(MATCHMAKING_CONFIG).toEqual({
					MAX_RATING_GAP: 400,
				});
			});
		});

		describe("queuedAt tracking", () => {
			test("records queuedAt when a player joins", () => {
				expect(queueAt("a", 1500, 0).queuedAt).toBe(T0);
			});

			test("keeps the original queuedAt when re-queued in the same tier", () => {
				queueAt("a", 1500, 0);
				const requeued = queueAt("a", 1500, 40);
				expect(requeued.queuedAt).toBe(T0);
				expect(service.getQueueSize()).toBe(1);
			});

			test("resets queuedAt when switching wager tier", () => {
				queueAt("a", 1500, 0, "free");
				expect(queueAt("a", 1500, 40, "high").queuedAt).toBe(sec(40));
			});

			test("reports current wait time and tolerance in queue status", () => {
				queueAt("a", 1500, 0);
				jest.spyOn(Date, "now").mockReturnValue(sec(31));
				expect(service.getQueueStatus("a")).toMatchObject({
					waitTimeSeconds: 31,
					ratingTolerance: 150,
				});
			});
		});

		describe("pairing windows", () => {
			test("pairs players within ±50 immediately", () => {
				queueAt("a", 1500, 0);
				queueAt("b", 1550, 0);
				expect(service.processQueue(sec(0))).toHaveLength(1);
			});

			test("gap of 80 does not pair before 10s, pairs at 10s", () => {
				queueAt("a", 1500, 0);
				queueAt("b", 1580, 0);

				expect(service.processQueue(sec(9.999))).toHaveLength(0);
				expect(service.processQueue(sec(10))).toHaveLength(1);
			});

			test("gap of 150 does not pair before 25s, pairs at 25s", () => {
				queueAt("a", 1500, 0);
				queueAt("b", 1650, 0);

				expect(service.processQueue(sec(24.999))).toHaveLength(0);
				expect(service.processQueue(sec(25))).toHaveLength(1);
			});

			test("gap of 350 does not pair before 45s, pairs at 45s", () => {
				queueAt("a", 1500, 0);
				queueAt("b", 1850, 0);

				expect(service.processQueue(sec(44.999))).toHaveLength(0);
				expect(service.processQueue(sec(45))).toHaveLength(1);
			});

			test("gap of 450 never pairs even after long waits", () => {
				queueAt("a", 1500, 0);
				queueAt("b", 1950, 0);

				expect(service.processQueue(sec(100))).toHaveLength(0);
				expect(service.processQueue(sec(3600))).toHaveLength(0);
				expect(service.getQueueSize()).toBe(2);
			});

			test("requires the gap to fit inside BOTH players' tolerances", () => {
				queueAt("veteran", 1500, 0); // waited 45s -> ±400
				queueAt("newcomer", 1700, 45); // just joined -> ±50

				expect(service.processQueue(sec(45))).toHaveLength(0);
				// Once the newcomer has waited 10s (±100), a 200-point gap is still too large
				expect(service.processQueue(sec(55))).toHaveLength(0);
				// Once the newcomer has waited 25s (±200), the 200-point gap fits in newcomer's window
				expect(service.processQueue(sec(70))).toHaveLength(1);
			});

			test("caps the rating gap at 400 no matter how long players wait", () => {
				queueAt("a", 1200, 0);
				queueAt("b", 1601, 0);

				expect(service.processQueue(sec(3600))).toHaveLength(0);
				expect(service.getQueueSize()).toBe(2);
			});

			test("pairs a gap of exactly 400 once tolerance is maxed", () => {
				queueAt("a", 1200, 0);
				queueAt("b", 1600, 0);

				expect(service.processQueue(sec(44.999))).toHaveLength(0);
				expect(service.processQueue(sec(45))).toHaveLength(1);
			});

			test("honours a lower configured maxRatingGap", () => {
				service.maxRatingGap = 100;
				queueAt("a", 1200, 0);
				queueAt("b", 1350, 0);
				expect(service.processQueue(sec(600))).toHaveLength(0);
			});

			test("never pairs across wager tiers even after long waits", () => {
				queueAt("a", 1500, 0, "low");
				queueAt("b", 1500, 0, "high");
				expect(service.processQueue(sec(600))).toHaveLength(0);
			});
		});

		describe("closest-pair selection", () => {
			test("pairs the closest ratings first across the whole queue", () => {
				// In insertion order a naive scan would pair a+b (gap 40) and leave c+d
				// unmatched; the closest-first pass pairs b+c (gap 10) instead.
				queueAt("a", 1500, 0);
				queueAt("b", 1540, 0);
				queueAt("c", 1550, 0);
				queueAt("d", 1700, 0);

				const matches = service.processQueue(sec(0));
				expect(matches).toHaveLength(1);
				expect([matches[0].player1.userId, matches[0].player2.userId].sort()).toEqual(["b", "c"]);
				expect(service.getQueueSize()).toBe(2);
			});

			test("pairs everyone it can in a single pass", () => {
				queueAt("a", 1500, 0);
				queueAt("b", 1510, 0);
				queueAt("c", 1600, 0);
				queueAt("d", 1605, 0);
				queueAt("e", 1900, 0);

				const matches = service.processQueue(sec(0));
				const pairs = matches.map((m) => [m.player1.userId, m.player2.userId].sort().join("+")).sort();
				expect(pairs).toEqual(["a+b", "c+d"]);
				expect(service.getQueueStatus("e")).not.toBeNull();
			});

			test("breaks gap ties in favour of the longest-waiting player", () => {
				queueAt("old", 1500, 0);
				queueAt("mid", 1530, 20);
				queueAt("new", 1560, 20);

				// old<->mid and mid<->new both have a 30-point gap
				const [match] = service.processQueue(sec(20));
				expect(match.player1.userId).toBe("old");
				expect(match.player2.userId).toBe("mid");
			});

			test("findMatch returns the closest eligible opponent", () => {
				queueAt("a", 1500, 0);
				queueAt("far", 1640, 0);
				queueAt("near", 1460, 0);

				const match = service.findMatch({ userId: "a" }, sec(30));
				expect(match.player1.userId).toBe("a");
				expect(match.player2.userId).toBe("near");
				expect(service.getQueueSize()).toBe(1);
			});

			test("findMatch prefers the longer-waiting opponent on equal gaps", () => {
				queueAt("a", 1500, 10);
				queueAt("waited", 1520, 0);
				queueAt("fresh", 1480, 10);

				expect(service.findMatch({ userId: "a" }, sec(10)).player2.userId).toBe("waited");
			});

			test("findMatch works for a player who is not queued yet", () => {
				queueAt("b", 1530, 0);
				const match = service.findMatch({ userId: "a", elo: 1500, wagerTier: "FREE" }, sec(0));
				expect(match.player2.userId).toBe("b");
			});

			test("findMatch returns null when no tolerance allows a pairing", () => {
				queueAt("a", 1500, 0);
				queueAt("b", 1600, 0);
				expect(service.findMatch({ userId: "a" }, sec(0))).toBeNull();
				expect(service.findMatch(null)).toBeNull();
			});
		});

		describe("queue worker", () => {
			test("pairs players automatically once their windows expand", () => {
				jest.useFakeTimers({ now: T0 });
				service.addToQueue({ userId: "a", socketId: "sa", elo: 1500 });
				service.addToQueue({ userId: "b", socketId: "sb", elo: 1600 });

				const onMatch = jest.fn();
				service.startQueueWorker({ onMatch, intervalMs: 1000 });

				jest.advanceTimersByTime(14000);
				expect(onMatch).not.toHaveBeenCalled();

				jest.advanceTimersByTime(1000);
				expect(onMatch).toHaveBeenCalledTimes(1);
				expect(onMatch.mock.calls[0][0].player1.userId).toBe("a");
				expect(service.getQueueSize()).toBe(0);
			});

			test("keeps delivering matches when one handler throws", () => {
				jest.useFakeTimers({ now: T0 });
				jest.spyOn(console, "error").mockImplementation(() => {});
				service.addToQueue({ userId: "a", socketId: "sa", elo: 1500 });
				service.addToQueue({ userId: "b", socketId: "sb", elo: 1500 });
				service.addToQueue({ userId: "c", socketId: "sc", elo: 1800 });
				service.addToQueue({ userId: "d", socketId: "sd", elo: 1800 });

				const onMatch = jest.fn().mockImplementationOnce(() => {
					throw new Error("socket gone");
				});
				service.startQueueWorker({ onMatch });
				jest.advanceTimersByTime(1000);

				expect(onMatch).toHaveBeenCalledTimes(2);
				expect(console.error).toHaveBeenCalled();
			});

			test("stopQueueWorker halts polling", () => {
				jest.useFakeTimers({ now: T0 });
				const onMatch = jest.fn();
				service.startQueueWorker({ onMatch });
				service.stopQueueWorker();

				service.addToQueue({ userId: "a", socketId: "sa", elo: 1500 });
				service.addToQueue({ userId: "b", socketId: "sb", elo: 1500 });
				jest.advanceTimersByTime(5000);

				expect(onMatch).not.toHaveBeenCalled();
				expect(service.pollTimer).toBeNull();
			});

			test("requires an onMatch callback", () => {
				expect(() => service.startQueueWorker()).toThrow("onMatch callback is required");
			});
		});
	});
});
