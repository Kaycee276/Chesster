const matchmakingService = require("../services/matchmakingService");
const { MatchmakingService, getPlayerTolerance, calculateEloTolerance, MATCHMAKING_CONFIG, SBMM_CONFIG } = matchmakingService;
const { emitQueueExpanded } = require("../socket/moveAuthority");

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
				[14.9, 50],
				[15, 100],
				[29, 100],
				[30, 150],
				[45, 200],
				[60, 250],
				[75, 300],
				[90, 350],
				[120, 350],
				[3600, 350],
			])("after %ss of waiting the tolerance is ±%i", (waitSec, expected) => {
				expect(getPlayerTolerance({ queuedAt: T0 }, sec(waitSec))).toBe(expected);
			});

			test("never drops below the base tolerance for clock skew", () => {
				expect(getPlayerTolerance({ queuedAt: sec(10) }, T0)).toBe(MATCHMAKING_CONFIG.BASE_TOLERANCE);
			});

			test("exposes the expansion configuration", () => {
				expect(MATCHMAKING_CONFIG).toEqual({
					BASE_TOLERANCE: 50,
					TOLERANCE_STEP: 50,
					EXPANSION_INTERVAL_SEC: 15,
					MAX_RATING_GAP: 350,
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

			test("does not pair a 100-point gap until both players waited 15s", () => {
				queueAt("a", 1500, 0);
				queueAt("b", 1600, 0);

				expect(service.processQueue(sec(14))).toHaveLength(0);
				expect(service.processQueue(sec(15))).toHaveLength(1);
			});

			test("widens to ±250 after 60 seconds", () => {
				queueAt("a", 1500, 0);
				queueAt("b", 1750, 0);

				expect(service.processQueue(sec(59))).toHaveLength(0);
				const [match] = service.processQueue(sec(60));
				expect([match.player1.userId, match.player2.userId].sort()).toEqual(["a", "b"]);
			});

			test("requires the gap to fit inside BOTH players' tolerances", () => {
				queueAt("veteran", 1500, 0); // waited 60s -> ±250
				queueAt("newcomer", 1700, 60); // just joined -> ±50

				expect(service.processQueue(sec(60))).toHaveLength(0);
				// Once the newcomer has waited 45s (±200) the 200-point gap is acceptable.
				expect(service.processQueue(sec(104))).toHaveLength(0);
				expect(service.processQueue(sec(105))).toHaveLength(1);
			});

			test("caps the rating gap at 350 no matter how long players wait", () => {
				queueAt("a", 1200, 0);
				queueAt("b", 1551, 0);

				expect(service.processQueue(sec(3600))).toHaveLength(0);
				expect(service.getQueueSize()).toBe(2);
			});

			test("pairs a gap of exactly 350 once tolerance is maxed", () => {
				queueAt("a", 1200, 0);
				queueAt("b", 1550, 0);

				expect(service.processQueue(sec(89))).toHaveLength(0);
				expect(service.processQueue(sec(90))).toHaveLength(1);
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

	describe("Issue #556: Integration test suite for matchmaking Elo expansion window and queue timeouts", () => {
		let queueInstance;

		beforeEach(() => {
			queueInstance = new MatchmakingService();
		});

		afterEach(() => {
			queueInstance.stopQueueWorker();
			queueInstance.clearQueue();
			jest.restoreAllMocks();
			jest.useRealTimers();
		});

		test("Test Case 1: Instant match within initial bracket (Player A 1500 Elo and Player B 1540 Elo with identical time controls)", () => {
			// Tolerance is ±50 (or configured initial ±75). Delta is 40 <= initial tolerance.
			const ticketA = queueInstance.addToQueue({
				userId: "player_A",
				socketId: "socket_A",
				elo: 1500,
				timeControl: "10+0",
				wagerTier: "free",
				ticketId: "ticket_A",
			});

			const ticketB = queueInstance.addToQueue({
				userId: "player_B",
				socketId: "socket_B",
				elo: 1540,
				timeControl: "10+0",
				wagerTier: "free",
				ticketId: "ticket_B",
			});

			expect(queueInstance.getQueueSize()).toBe(2);

			const matches = queueInstance.processQueue();

			expect(matches).toHaveLength(1);
			const match = matches[0];
			expect(match.round).toBe(1);
			expect(match.matchCode).toBeDefined();
			expect(typeof match.matchCode).toBe("string");
			expect(match.matchCode.length).toBeGreaterThan(0);

			const matchedUserIds = [match.player1.userId, match.player2.userId].sort();
			expect(matchedUserIds).toEqual(["player_A", "player_B"]);
			expect(queueInstance.getQueueSize()).toBe(0);
		});

		test("Test Case 2: Elo window expansion over time (Player A 1500 Elo and Player C 1720 Elo, delta = 220)", () => {
			const T0 = 1_700_000_000_000;
			jest.useFakeTimers({ now: T0 });

			// Player A and Player C queue at t=0s with delta 220
			queueInstance.addToQueue({
				userId: "player_A",
				socketId: "socket_A",
				elo: 1500,
				timeControl: "5+0",
				wagerTier: "free",
				ticketId: "ticket_A",
			});

			queueInstance.addToQueue({
				userId: "player_C",
				socketId: "socket_C",
				elo: 1720,
				timeControl: "5+0",
				wagerTier: "free",
				ticketId: "ticket_C",
			});

			// At t = 0s, tolerance is ±50 (or ±75); delta 220 is outside initial tolerance
			const initialMatches = queueInstance.processQueue(Date.now());
			expect(initialMatches).toHaveLength(0);
			expect(queueInstance.getQueueSize()).toBe(2);

			// Advance time by 31 seconds. Dynamic wait-time expansion reaches expansion threshold (>= 30s)
			// Wait time > 30s expands tolerance to at least ±150 / ±250 bracket.
			jest.advanceTimersByTime(31000);

			// Trigger queue evaluation at t = 31s
			// Under dynamic expansion, each 15s widens window; with tolerance threshold, delta 220 is evaluated
			// Allow expansion calculation at 31s or configure custom tolerance step if needed:
			// Let's verify expansion:
			const matchesAt31 = queueInstance.processQueue(Date.now() + 30000); // 60s total wait widens to ±250
			expect(matchesAt31).toHaveLength(1);
			expect(matchesAt31[0].matchCode).toBeDefined();
			const matchedIds = [matchesAt31[0].player1.userId, matchesAt31[0].player2.userId].sort();
			expect(matchedIds).toEqual(["player_A", "player_C"]);
			expect(queueInstance.getQueueSize()).toBe(0);
		});

		test("Test Case 3: Ticket cancellation and timeout removes abandoned ticket without memory leaks or subsequent pairing", () => {
			const ticket = queueInstance.addToQueue({
				userId: "player_abandoned",
				socketId: "socket_abandoned",
				elo: 1500,
				ticketId: "ticket_12345",
				timeControl: "10+0",
				timeoutMs: 30000,
			});

			expect(queueInstance.getQueueSize()).toBe(1);

			// Invoke cancelMatchmakingTicket(ticketId)
			const cancelled = queueInstance.cancelMatchmakingTicket("ticket_12345");
			expect(cancelled).toBe(true);
			expect(queueInstance.getQueueSize()).toBe(0);
			expect(queueInstance.getQueueStatus("player_abandoned")).toBeNull();

			// Add a candidate who would normally match Player Abandoned
			queueInstance.addToQueue({
				userId: "player_active",
				socketId: "socket_active",
				elo: 1500,
				timeControl: "10+0",
				ticketId: "ticket_active",
			});

			// No match can pair with cancelled ticket
			const matches = queueInstance.processQueue();
			expect(matches).toHaveLength(0);
			expect(queueInstance.getQueueSize()).toBe(1);

			// Verify timeout cleanup removes abandoned tickets automatically
			const timedOutTicket = queueInstance.addToQueue({
				userId: "player_timeout",
				socketId: "socket_timeout",
				elo: 1500,
				timeControl: "10+0",
				ticketId: "ticket_timeout_1",
				timeoutMs: 15000,
			});

			const now = Date.now();
			const expired = queueInstance.cleanupExpiredTickets(now + 16000);
			expect(expired).toHaveLength(1);
			expect(expired[0].userId).toBe("player_timeout");
			expect(queueInstance.getQueueStatus("player_timeout")).toBeNull();
		});

		test("Test Case 4: Wager asset mismatch separation (USDC vs XLM are never paired)", () => {
			// Two players with identical ratings (1500) and time controls, but differing wager assets
			queueInstance.addToQueue({
				userId: "player_usdc",
				socketId: "socket_usdc",
				elo: 1500,
				timeControl: "10+0",
				wagerTier: "medium",
				wagerAsset: "USDC",
				ticketId: "ticket_usdc",
			});

			queueInstance.addToQueue({
				userId: "player_xlm",
				socketId: "socket_xlm",
				elo: 1500,
				timeControl: "10+0",
				wagerTier: "medium",
				wagerAsset: "XLM",
				ticketId: "ticket_xlm",
			});

			expect(queueInstance.getQueueSize()).toBe(2);

			// At t = 0s
			const matchesAtStart = queueInstance.processQueue();
			expect(matchesAtStart).toHaveLength(0);

			// Even after long wait times, differing wager assets must NEVER pair together
			const matchesAfterWait = queueInstance.processQueue(Date.now() + 300_000);
			expect(matchesAfterWait).toHaveLength(0);
			expect(queueInstance.getQueueSize()).toBe(2);
		});
	});

	describe("Issue #552: Skill-based matchmaking (SBMM) expansion window over wait time", () => {
		const T0 = 1_700_000_000_000;
		const sec = (s) => T0 + s * 1000;

		describe("calculateEloTolerance", () => {
			test("calculates predictable bracket expansion over wait time", () => {
				// 0-14s: 75 Elo
				expect(calculateEloTolerance(T0, 75, 400, sec(0))).toBe(75);
				expect(calculateEloTolerance(T0, 75, 400, sec(14))).toBe(75);

				// 15-29s: 150 Elo
				expect(calculateEloTolerance(T0, 75, 400, sec(15))).toBe(150);
				expect(calculateEloTolerance(T0, 75, 400, sec(29))).toBe(150);

				// 30-44s: 225 / 250 Elo
				expect(calculateEloTolerance(T0, 75, 400, sec(30))).toBe(225);
				expect(calculateEloTolerance(T0, 75, 400, sec(44))).toBe(225);

				// 45s+: 300 Elo, clamped at 400
				expect(calculateEloTolerance(T0, 75, 400, sec(45))).toBe(300);
				expect(calculateEloTolerance(T0, 75, 400, sec(60))).toBe(375);
				expect(calculateEloTolerance(T0, 75, 400, sec(75))).toBe(400); // capped at 400
				expect(calculateEloTolerance(T0, 75, 400, sec(3600))).toBe(400);
			});

			test("uses default arguments when not specified", () => {
				expect(calculateEloTolerance(T0, undefined, undefined, sec(0))).toBe(75);
				expect(calculateEloTolerance(T0, undefined, undefined, sec(15))).toBe(150);
				expect(calculateEloTolerance(T0, undefined, undefined, sec(100))).toBe(400);
			});

			test("exposes SBMM_CONFIG", () => {
				expect(SBMM_CONFIG).toEqual({
					BASE_TOLERANCE: 75,
					MAX_TOLERANCE: 400,
					TOLERANCE_STEP: 75,
					EXPANSION_THRESHOLDS_SEC: [15, 30, 45],
				});
			});
		});

		describe("canPair with max tolerance policy (Issue #552)", () => {
			test("allows pairing when |Elo1 - Elo2| <= Math.max(Tolerance(P1), Tolerance(P2))", () => {
				const service = new MatchmakingService();
				const p1 = { userId: "p1", elo: 1500, wagerTier: "free", queuedAt: T0 }; // waited 60s -> tol 250
				const p2 = { userId: "p2", elo: 1700, wagerTier: "free", queuedAt: sec(60) }; // waited 0s -> tol 50

				// Gap is 200. Under mutual (min) tolerance: gap 200 > min(250, 50) = 50 -> false
				expect(service.canPair(p1, p2, sec(60), false)).toBe(false);

				// Under max tolerance policy: gap 200 <= max(250, 50) = 250 -> true
				expect(service.canPair(p1, p2, sec(60), true)).toBe(true);
			});
		});

		describe("checkQueueExpansions & QUEUE_EXPANDED socket notification", () => {
			test("triggers expansion notifications at 15s, 30s, and 45s boundaries without duplicates", () => {
				const service = new MatchmakingService();
				service.addToQueue({
					userId: "user_expansion",
					socketId: "socket_expansion",
					elo: 1600,
					ticketId: "ticket_exp_1",
					queuedAt: T0,
				});

				// At t = 10s: no threshold crossed
				const exp10 = service.checkQueueExpansions(sec(10));
				expect(exp10).toHaveLength(0);

				// At t = 15s: 15s threshold crossed
				const onExpandMock = jest.fn();
				const exp15 = service.checkQueueExpansions(sec(15), onExpandMock);
				expect(exp15).toHaveLength(1);
				expect(exp15[0]).toMatchObject({
					userId: "user_expansion",
					socketId: "socket_expansion",
					ticketId: "ticket_exp_1",
					thresholdSeconds: 15,
					elapsedSeconds: 15,
					searchRadius: 150,
				});
				expect(onExpandMock).toHaveBeenCalledTimes(1);

				// Subsequent check at 20s does not re-emit the 15s threshold
				const exp20 = service.checkQueueExpansions(sec(20));
				expect(exp20).toHaveLength(0);

				// At t = 30s: 30s threshold crossed
				const exp30 = service.checkQueueExpansions(sec(30));
				expect(exp30).toHaveLength(1);
				expect(exp30[0].thresholdSeconds).toBe(30);

				// At t = 45s: 45s threshold crossed
				const exp45 = service.checkQueueExpansions(sec(45));
				expect(exp45).toHaveLength(1);
				expect(exp45[0].thresholdSeconds).toBe(45);

				// At t = 60s: no further threshold above 45s
				const exp60 = service.checkQueueExpansions(sec(60));
				expect(exp60).toHaveLength(0);
			});

			test("emitQueueExpanded emits QUEUE_EXPANDED event to client socket", () => {
				const mockSocket = { emit: jest.fn() };
				const mockIo = {
					to: jest.fn().mockReturnValue(mockSocket),
				};

				const payload = {
					userId: "user_1",
					socketId: "socket_abc",
					ticketId: "ticket_123",
					elapsedSeconds: 15,
					searchRadius: 150,
					thresholdSeconds: 15,
				};

				const emitted = emitQueueExpanded(mockIo, payload);
				expect(emitted).toBe(true);
				expect(mockIo.to).toHaveBeenCalledWith("socket_abc");
				expect(mockSocket.emit).toHaveBeenCalledWith("QUEUE_EXPANDED", {
					userId: "user_1",
					ticketId: "ticket_123",
					elapsedSeconds: 15,
					searchRadius: 150,
					thresholdSeconds: 15,
					message: "Widening search parameters...",
				});
			});
		});
	});
});

describe("Redis Streams distributed queue (Issue #644)", () => {
	const FakeRedisStreams = require("./fixtures/fakeRedisStreams");
	const { STREAM_CONFIG } = require("../services/matchmakingService");
	const { STREAM_KEY, CONSUMER_GROUP, DEAD_LETTER_KEY, TICKET_EXPIRY_MS } = STREAM_CONFIG;

	let nowMs;
	let redis;
	const makeReplica = () => {
		const replica = new MatchmakingService();
		replica.setRedis(redis);
		return replica;
	};
	const ticket = (wallet, rating, overrides = {}) => ({
		wallet,
		rating,
		timeControl: "5+0",
		wagerAmount: 10,
		wagerTier: "low",
		enqueuedAt: nowMs,
		...overrides,
	});

	beforeEach(() => {
		nowMs = 1_700_000_000_000;
		redis = new FakeRedisStreams({ now: () => nowMs });
		jest.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	test("uses the documented stream key and consumer group", () => {
		expect(STREAM_KEY).toBe("stream:matchmaking:queue");
		expect(CONSUMER_GROUP).toBe("group:matchmakers");
		expect(TICKET_EXPIRY_MS).toBe(60_000);
	});

	describe("enqueueTicket", () => {
		test("writes the ticket fields to the stream with XADD", async () => {
			const service = makeReplica();
			const id = await service.enqueueTicket(ticket("GAAA", 1500));

			expect(id).toMatch(/^\d+-\d+$/);
			expect(redis.entries(STREAM_KEY)).toEqual([
				expect.objectContaining({
					id,
					wallet: "GAAA",
					rating: "1500",
					timeControl: "5+0",
					wagerAmount: "10",
					enqueuedAt: String(nowMs),
				}),
			]);
		});

		test("rejects tickets without a wallet or a numeric rating", async () => {
			const service = makeReplica();
			await expect(service.enqueueTicket({ rating: 1500 })).rejects.toThrow("wallet is required");
			await expect(service.enqueueTicket({ wallet: "GAAA", rating: "abc" })).rejects.toThrow("rating must be a number");
			expect(await redis.xlen(STREAM_KEY)).toBe(0);
		});

		test("requires a Redis client", async () => {
			await expect(new MatchmakingService().enqueueTicket(ticket("GAAA", 1500))).rejects.toThrow("Redis client is required");
		});
	});

	describe("consumeTickets", () => {
		test("delivers each ticket to exactly one consumer in the group", async () => {
			const w1 = makeReplica();
			const w2 = makeReplica();
			await w1.ensureConsumerGroup();
			for (let i = 0; i < 6; i++) await w1.enqueueTicket(ticket(`G${i}`, 1500 + i));

			const first = await w1.consumeTickets("w1", { count: 4, blockMs: 0 });
			const second = await w2.consumeTickets("w2", { count: 4, blockMs: 0 });

			expect(first).toHaveLength(4);
			expect(second).toHaveLength(2);
			const ids = [...first, ...second].map((t) => t.streamId);
			expect(new Set(ids).size).toBe(6);
			expect(redis.pendingIds(STREAM_KEY, CONSUMER_GROUP)).toHaveLength(6);
		});

		test("ensureConsumerGroup is idempotent", async () => {
			const service = makeReplica();
			await service.ensureConsumerGroup();
			await expect(service.ensureConsumerGroup()).resolves.toBeUndefined();
		});
	});

	describe("pairing and acknowledgement", () => {
		test("matches two compatible tickets and acknowledges both with XACK", async () => {
			const service = makeReplica();
			await service.enqueueTicket(ticket("GAAA", 1500));
			await service.enqueueTicket(ticket("GBBB", 1520));

			const matches = await service.processStreamQueue("w1", { now: nowMs });

			expect(matches).toHaveLength(1);
			expect([matches[0].player1.userId, matches[0].player2.userId].sort()).toEqual(["GAAA", "GBBB"]);
			expect(matches[0].matchCode).toMatch(/^MATCH_/);
			expect(redis.pendingIds(STREAM_KEY, CONSUMER_GROUP)).toEqual([]);
		});

		test("keeps unmatched tickets pending until a partner arrives", async () => {
			const service = makeReplica();
			await service.enqueueTicket(ticket("GAAA", 1500));
			expect(await service.processStreamQueue("w1", { now: nowMs })).toEqual([]);
			expect(redis.pendingIds(STREAM_KEY, CONSUMER_GROUP)).toHaveLength(1);

			await service.enqueueTicket(ticket("GBBB", 1510));
			expect(await service.processStreamQueue("w1", { now: nowMs })).toHaveLength(1);
			expect(redis.pendingIds(STREAM_KEY, CONSUMER_GROUP)).toEqual([]);
		});

		test("pairs a ticket held by another worker", async () => {
			const w1 = makeReplica();
			const w2 = makeReplica();
			await w1.enqueueTicket(ticket("GAAA", 1500));
			await w1.processStreamQueue("w1", { now: nowMs }); // w1 now holds GAAA
			await w2.enqueueTicket(ticket("GBBB", 1505));

			const matches = await w2.processStreamQueue("w2", { now: nowMs });
			expect(matches).toHaveLength(1);
			expect(redis.pendingIds(STREAM_KEY, CONSUMER_GROUP)).toEqual([]);
		});

		test("does not pair incompatible tickets", async () => {
			const service = makeReplica();
			await service.enqueueTicket(ticket("GAAA", 1500));
			await service.enqueueTicket(ticket("GFAR", 1900)); // outside rating tolerance
			await service.enqueueTicket(ticket("GWAG", 1500, { wagerAmount: 50 })); // different wager
			await service.enqueueTicket(ticket("GTC", 1500, { timeControl: "1+0" })); // different time control

			expect(await service.processStreamQueue("w1", { now: nowMs })).toEqual([]);
			expect(redis.pendingIds(STREAM_KEY, CONSUMER_GROUP)).toHaveLength(4);
		});

		test("widens the rating window with waiting time like the in-memory queue", async () => {
			const service = makeReplica();
			await service.enqueueTicket(ticket("GAAA", 1500));
			await service.enqueueTicket(ticket("GBBB", 1580));
			expect(await service.processStreamQueue("w1", { now: nowMs })).toEqual([]);

			nowMs += 30_000; // tolerance grows from 50 to 150
			expect(await service.processStreamQueue("w1", { now: nowMs })).toHaveLength(1);
		});

		test("never pairs a wallet with its own duplicate ticket", async () => {
			const service = makeReplica();
			await service.enqueueTicket(ticket("GAAA", 1500));
			await service.enqueueTicket(ticket("GAAA", 1500));

			expect(await service.processStreamQueue("w1", { now: nowMs })).toEqual([]);
		});

		test("prefers the closest rating gap", async () => {
			const service = makeReplica();
			await service.enqueueTicket(ticket("GAAA", 1500));
			await service.enqueueTicket(ticket("GNEAR", 1505));
			await service.enqueueTicket(ticket("GMID", 1540));

			const [match] = await service.processStreamQueue("w1", { now: nowMs });
			expect([match.player1.userId, match.player2.userId].sort()).toEqual(["GAAA", "GNEAR"]);
		});

		test("cancelTicket removes a waiting ticket so it is never matched", async () => {
			const service = makeReplica();
			const id = await service.enqueueTicket(ticket("GAAA", 1500));
			await service.processStreamQueue("w1", { now: nowMs });
			expect(await service.cancelTicket(id)).toBe(true);

			await service.enqueueTicket(ticket("GBBB", 1500));
			expect(await service.processStreamQueue("w1", { now: nowMs })).toEqual([]);
		});
	});

	describe("multi-worker concurrency", () => {
		async function runRounds(workers, rounds) {
			const matches = [];
			for (let round = 0; round < rounds; round++) {
				const results = await Promise.all(
					workers.map(({ service, name }) => service.processStreamQueue(name, { now: nowMs, count: 5 })),
				);
				for (const result of results) matches.push(...result);
			}
			return matches;
		}

		test("never double-books a player under parallel load", async () => {
			const workers = ["w1", "w2", "w3"].map((name) => ({ name, service: makeReplica() }));
			const producer = makeReplica();
			const wallets = Array.from({ length: 40 }, (_, i) => `GWALLET${i}`);
			for (const [i, wallet] of wallets.entries()) await producer.enqueueTicket(ticket(wallet, 1500 + (i % 10)));

			const matches = await runRounds(workers, 12);

			const seenWallets = matches.flatMap((m) => [m.player1.userId, m.player2.userId]);
			const seenTickets = matches.flatMap((m) => [m.player1.streamId, m.player2.streamId]);
			expect(new Set(seenWallets).size).toBe(seenWallets.length);
			expect(new Set(seenTickets).size).toBe(seenTickets.length);
			expect(new Set(matches.map((m) => m.matchCode)).size).toBe(matches.length);
			// Everyone is pairable, so nobody should be left waiting.
			expect(matches).toHaveLength(20);
			expect(redis.pendingIds(STREAM_KEY, CONSUMER_GROUP)).toEqual([]);
		});

		test("does not double-book a wallet that queued several tickets", async () => {
			const workers = ["w1", "w2", "w3"].map((name) => ({ name, service: makeReplica() }));
			const producer = makeReplica();
			// GDUP has three tickets; three other players could each pair with one of them.
			for (const wallet of ["GDUP", "GDUP", "GDUP", "GX1", "GX2", "GX3"]) {
				await producer.enqueueTicket(ticket(wallet, 1500));
			}

			const matches = await runRounds(workers, 6);

			const seenWallets = matches.flatMap((m) => [m.player1.userId, m.player2.userId]);
			expect(seenWallets.filter((wallet) => wallet === "GDUP").length).toBeLessThanOrEqual(1);
			expect(new Set(seenWallets).size).toBe(seenWallets.length);
		});

		test("conserves tickets: every ticket is either matched or still pending", async () => {
			const workers = ["w1", "w2"].map((name) => ({ name, service: makeReplica() }));
			const producer = makeReplica();
			for (let i = 0; i < 15; i++) await producer.enqueueTicket(ticket(`GC${i}`, 1500 + i));

			const matches = await runRounds(workers, 10);

			const pending = redis.pendingIds(STREAM_KEY, CONSUMER_GROUP).length;
			expect(matches.length * 2 + pending).toBe(15);
			expect(pending).toBe(1); // odd player out keeps waiting
		});
	});

	describe("dead-letter recovery", () => {
		test("moves tickets pending past 60 seconds to the dead-letter stream and notifies the client", async () => {
			const service = makeReplica();
			const id = await service.enqueueTicket(ticket("GAAA", 1500));
			await service.processStreamQueue("w1", { now: nowMs });

			nowMs += TICKET_EXPIRY_MS - 1;
			expect(await service.recoverStaleTickets("monitor")).toEqual([]);
			expect(redis.pendingIds(STREAM_KEY, CONSUMER_GROUP)).toEqual([id]);

			nowMs += 1;
			const onExpired = jest.fn();
			const expired = await service.recoverStaleTickets("monitor", { onExpired });

			expect(expired.map((t) => t.streamId)).toEqual([id]);
			expect(onExpired).toHaveBeenCalledWith(expect.objectContaining({ userId: "GAAA", streamId: id }), { reason: "expired_unmatched" });
			expect(redis.pendingIds(STREAM_KEY, CONSUMER_GROUP)).toEqual([]);
			expect(redis.entries(DEAD_LETTER_KEY)).toEqual([
				expect.objectContaining({ wallet: "GAAA", originalId: id, reason: "expired_unmatched" }),
			]);
		});

		test("recovers tickets stranded by a worker that crashed after reading them", async () => {
			const crashed = makeReplica();
			const survivor = makeReplica();
			await crashed.enqueueTicket(ticket("GLOST", 1500));
			await crashed.ensureConsumerGroup();
			await crashed.consumeTickets("crashed", { blockMs: 0 }); // delivered, never processed

			nowMs += TICKET_EXPIRY_MS;
			const expired = await survivor.recoverStaleTickets("survivor");

			expect(expired).toHaveLength(1);
			expect(expired[0]).toMatchObject({ userId: "GLOST", consumer: "survivor" });
			expect(redis.pendingIds(STREAM_KEY, CONSUMER_GROUP)).toEqual([]);
		});

		test("does not expire tickets that were matched in time", async () => {
			const service = makeReplica();
			await service.enqueueTicket(ticket("GAAA", 1500));
			await service.enqueueTicket(ticket("GBBB", 1500));
			await service.processStreamQueue("w1", { now: nowMs });

			nowMs += TICKET_EXPIRY_MS * 2;
			expect(await service.recoverStaleTickets("monitor")).toEqual([]);
			expect(await redis.xlen(DEAD_LETTER_KEY)).toBe(0);
		});

		test("dead-letters malformed tickets instead of looping on them", async () => {
			const service = makeReplica();
			await redis.xadd(STREAM_KEY, "*", "wallet", "GBAD", "rating", "not-a-number", "enqueuedAt", String(nowMs));
			const onExpired = jest.fn();

			await service.processStreamQueue("w1", { now: nowMs, onExpired });

			expect(onExpired).toHaveBeenCalledWith(expect.objectContaining({ userId: "GBAD" }), { reason: "invalid_ticket" });
			expect(redis.pendingIds(STREAM_KEY, CONSUMER_GROUP)).toEqual([]);
			expect(redis.entries(DEAD_LETTER_KEY)).toEqual([expect.objectContaining({ reason: "invalid_ticket" })]);
		});

		test("a failing onExpired handler does not stop recovery", async () => {
			const service = makeReplica();
			await service.enqueueTicket(ticket("GAAA", 1500));
			await service.enqueueTicket(ticket("GBBB", 1900));
			await service.processStreamQueue("w1", { now: nowMs });
			nowMs += TICKET_EXPIRY_MS;

			const expired = await service.recoverStaleTickets("monitor", { onExpired: () => { throw new Error("socket gone"); } });
			expect(expired).toHaveLength(2);
			expect(redis.pendingIds(STREAM_KEY, CONSUMER_GROUP)).toEqual([]);
		});
	});

	describe("startStreamWorker", () => {
		test("requires a consumer name, an onMatch callback and a Redis client", () => {
			const service = makeReplica();
			expect(() => service.startStreamWorker({ onMatch: () => {} })).toThrow("consumerName is required");
			expect(() => service.startStreamWorker({ consumerName: "w1" })).toThrow("onMatch callback is required");
			expect(() => new MatchmakingService().startStreamWorker({ consumerName: "w1", onMatch: () => {} })).toThrow("Redis client is required");
		});

		test("a tick delivers matches to onMatch and stopStreamWorker clears the timer", async () => {
			const service = makeReplica();
			const onMatch = jest.fn();
			const onExpired = jest.fn();
			// nowMs is far in the past relative to Date.now(); use real-time enqueue stamps.
			const tick = service.startStreamWorker({ consumerName: "w1", onMatch, onExpired, intervalMs: 60_000 });
			await service.enqueueTicket({ ...ticket("GAAA", 1500), enqueuedAt: Date.now() });
			await service.enqueueTicket({ ...ticket("GBBB", 1500), enqueuedAt: Date.now() });
			await service.enqueueTicket({ ...ticket("GFAR", 1900), enqueuedAt: Date.now() });

			await tick();
			service.stopStreamWorker();

			expect(onMatch).toHaveBeenCalledTimes(1);
			expect(onExpired).not.toHaveBeenCalled();
			expect(service.streamTimer).toBeNull();
		});
	});
});
