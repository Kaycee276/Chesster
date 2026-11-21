/**
 * Concurrent matchmaking stress tests: 100 simulated queue entrants.
 *
 * Exercises the real MatchmakingService API (addToQueue, removeFromQueue,
 * processQueue, startQueueWorker / stopQueueWorker) and asserts the pairing
 * invariants: no player in more than one match, unique match codes, identical
 * game settings within a pair, rating gaps within tolerance, and no leaked
 * timers.
 */

const matchmakingService = require("../services/matchmakingService");

const { MATCHMAKING_CONFIG, getPlayerTolerance } = matchmakingService;

const PERFORMANCE_BUDGET_MS = 1500;

// Waiting long enough that every entrant has reached the maximum tolerance window.
const FULLY_EXPANDED_WAIT_MS = 10 * 60 * 1000;

// Rating brackets from the issue. Each bracket is queued with its own game
// settings so each pairing pool has an even size and a rating spread that fits
// inside the hard rating-gap ceiling.
const BRACKETS = [
	{ name: "low", count: 40, min: 1200, max: 1400, timeControl: "3+0", wagerAsset: "XLM", wagerTier: "low" },
	{ name: "mid", count: 40, min: 1401, max: 1600, timeControl: "5+0", wagerAsset: "USDC", wagerTier: "medium" },
	{ name: "high", count: 20, min: 1800, max: 2200, timeControl: "3+0", wagerAsset: "XLM", wagerTier: "high" },
];

/** Small deterministic PRNG (mulberry32) so failures are reproducible. */
function createRng(seed) {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * Build the 40/40/20 ticket population. Ratings are spread evenly across each
 * bracket (with a little jitter) so a perfect pairing always exists.
 */
function buildTickets(now, rng = createRng(586)) {
	const tickets = [];
	let index = 0;
	for (const bracket of BRACKETS) {
		for (let i = 0; i < bracket.count; i++) {
			const span = bracket.max - bracket.min;
			const base = bracket.min + Math.floor((span * i) / (bracket.count - 1));
			const jitter = Math.floor(rng() * 3) - 1;
			const elo = Math.min(bracket.max, Math.max(bracket.min, base + jitter));
			tickets.push({
				userId: `GWALLET${String(index).padStart(3, "0")}`,
				socketId: `socket-${index}`,
				ticketId: `ticket-${index}`,
				elo,
				wagerTier: bracket.wagerTier,
				wagerAsset: bracket.wagerAsset,
				timeControl: bracket.timeControl,
				queuedAt: now - FULLY_EXPANDED_WAIT_MS,
			});
			index++;
		}
	}
	return tickets;
}

/** Shuffle a copy of the array (Fisher-Yates) using the supplied RNG. */
function shuffle(items, rng) {
	const copy = [...items];
	for (let i = copy.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[copy[i], copy[j]] = [copy[j], copy[i]];
	}
	return copy;
}

/** Enqueue every ticket concurrently, each on its own microtask. */
function enqueueAll(tickets) {
	return Promise.all(tickets.map(async (ticket) => matchmakingService.addToQueue(ticket)));
}

function assertMatchInvariants(matches, now) {
	const seenPlayers = new Set();
	const seenCodes = new Set();

	for (const match of matches) {
		const { player1, player2, matchCode } = match;

		expect(player1.userId).not.toBe(player2.userId);

		// No player in more than one match.
		for (const player of [player1, player2]) {
			expect(seenPlayers.has(player.userId)).toBe(false);
			seenPlayers.add(player.userId);
		}

		// Match codes are unique.
		expect(typeof matchCode).toBe("string");
		expect(seenCodes.has(matchCode)).toBe(false);
		seenCodes.add(matchCode);

		// Identical game settings inside a pair.
		expect(player2.wagerTier).toBe(player1.wagerTier);
		expect(player2.wagerAsset).toBe(player1.wagerAsset);
		expect(player2.timeControl).toBe(player1.timeControl);

		// Rating gap respects both players' tolerance and the hard ceiling.
		const gap = Math.abs(player1.elo - player2.elo);
		const tolerance = Math.min(getPlayerTolerance(player1, now), getPlayerTolerance(player2, now));
		expect(gap).toBeLessThanOrEqual(tolerance);
		expect(gap).toBeLessThanOrEqual(MATCHMAKING_CONFIG.MAX_RATING_GAP);
	}

	return seenPlayers;
}

describe("Matchmaking stress: 100 concurrent queue entrants", () => {
	beforeEach(() => {
		matchmakingService.stopQueueWorker();
		matchmakingService.clearQueue();
	});

	afterEach(() => {
		matchmakingService.stopQueueWorker();
		matchmakingService.clearQueue();
		jest.useRealTimers();
	});

	afterAll(() => {
		matchmakingService.stopQueueWorker();
		matchmakingService.clearQueue();
	});

	test("generates the 40/40/20 rating distribution from the issue", () => {
		const tickets = buildTickets(Date.now());
		expect(tickets).toHaveLength(100);
		expect(new Set(tickets.map((t) => t.userId)).size).toBe(100);

		for (const bracket of BRACKETS) {
			const inBracket = tickets.filter((t) => t.wagerTier === bracket.wagerTier);
			expect(inBracket).toHaveLength(bracket.count);
			for (const ticket of inBracket) {
				expect(ticket.elo).toBeGreaterThanOrEqual(bracket.min);
				expect(ticket.elo).toBeLessThanOrEqual(bracket.max);
			}
		}
	});

	test("pairs all 100 entrants into exactly 50 valid matches within the time budget", async () => {
		const now = Date.now();
		const tickets = shuffle(buildTickets(now), createRng(1));

		await enqueueAll(tickets);
		expect(matchmakingService.getQueueSize()).toBe(100);

		const start = performance.now();
		const matches = matchmakingService.processQueue(now);
		const elapsedMs = performance.now() - start;

		expect(elapsedMs).toBeLessThan(PERFORMANCE_BUDGET_MS);
		expect(matches).toHaveLength(50);

		const pairedPlayers = assertMatchInvariants(matches, now);
		expect(pairedPlayers.size).toBe(100);

		// Every ticket is accounted for and the queue is drained.
		expect(new Set(tickets.map((t) => t.userId))).toEqual(pairedPlayers);
		expect(matchmakingService.getQueueSize()).toBe(0);
	});

	test("a second evaluation round finds nothing left to pair", async () => {
		const now = Date.now();
		await enqueueAll(buildTickets(now));

		expect(matchmakingService.processQueue(now)).toHaveLength(50);
		expect(matchmakingService.processQueue(now)).toEqual([]);
	});

	test("pairs consistently regardless of arrival order", async () => {
		const now = Date.now();
		for (const seed of [2, 3, 4]) {
			matchmakingService.clearQueue();
			await enqueueAll(shuffle(buildTickets(now), createRng(seed)));

			const matches = matchmakingService.processQueue(now);
			expect(matches).toHaveLength(50);
			expect(assertMatchInvariants(matches, now).size).toBe(100);
		}
	});

	test("never pairs players with different wager tier, asset or time control", async () => {
		const now = Date.now();
		const queuedAt = now - FULLY_EXPANDED_WAIT_MS;
		// Identical ratings, so only the game settings can keep these apart.
		const variants = [
			{ wagerTier: "low", wagerAsset: "XLM", timeControl: "3+0" },
			{ wagerTier: "low", wagerAsset: "USDC", timeControl: "3+0" },
			{ wagerTier: "low", wagerAsset: "XLM", timeControl: "5+0" },
			{ wagerTier: "high", wagerAsset: "XLM", timeControl: "3+0" },
		];
		const tickets = Array.from({ length: 100 }, (_, i) => ({
			userId: `MIX${i}`,
			socketId: `mix-socket-${i}`,
			elo: 1500,
			queuedAt,
			...variants[i % variants.length],
		}));

		await enqueueAll(tickets);
		const matches = matchmakingService.processQueue(now);

		// 25 players per variant (odd): 12 pairs each, one left over per variant.
		expect(matches).toHaveLength(48);
		assertMatchInvariants(matches, now);
		expect(matchmakingService.getQueueSize()).toBe(4);
	});

	test("respects the rating tolerance for freshly queued players", async () => {
		const now = Date.now();
		// 100 players, 100 points apart, all brand new (tolerance 50): no valid pairs.
		const tickets = Array.from({ length: 100 }, (_, i) => ({
			userId: `SPREAD${i}`,
			socketId: `spread-socket-${i}`,
			elo: 1000 + i * 100,
			wagerTier: "low",
			wagerAsset: "XLM",
			timeControl: "3+0",
			queuedAt: now,
		}));

		await enqueueAll(tickets);
		expect(matchmakingService.processQueue(now)).toEqual([]);
		expect(matchmakingService.getQueueSize()).toBe(100);
	});

	test("leaves unmatched players with valid queue state when the pool is uneven", async () => {
		const now = Date.now();
		const tickets = buildTickets(now);
		// Drop one player from the 20-player high bracket so it becomes odd (19).
		const highBracket = tickets.filter((t) => t.wagerTier === "high");
		const dropped = highBracket[0];
		const entrants = tickets.filter((t) => t.userId !== dropped.userId);

		await enqueueAll(entrants);
		const matches = matchmakingService.processQueue(now);

		expect(matches).toHaveLength(49);
		const paired = assertMatchInvariants(matches, now);
		expect(paired.size).toBe(98);

		expect(matchmakingService.getQueueSize()).toBe(1);
		const leftoverId = entrants.map((t) => t.userId).find((id) => !paired.has(id));
		const status = matchmakingService.getQueueStatus(leftoverId);
		expect(status).not.toBeNull();
		expect(status.userId).toBe(leftoverId);
		expect(status.wagerTier).toBe("high");
	});

	test("cancelled entrants never appear in a match when cancellations race with enqueues", async () => {
		const now = Date.now();
		const tickets = shuffle(buildTickets(now), createRng(5));
		const cancelled = tickets.slice(0, 20);
		const cancelledIds = new Set(cancelled.map((t) => t.userId));

		// Interleave enqueue and cancellation across the same Promise.all().
		await Promise.all(
			tickets.map(async (ticket) => {
				matchmakingService.addToQueue(ticket);
				if (cancelledIds.has(ticket.userId)) {
					await Promise.resolve();
					expect(matchmakingService.removeFromQueue(ticket.ticketId)).toBe(true);
				}
			})
		);

		expect(matchmakingService.getQueueSize()).toBe(80);

		const matches = matchmakingService.processQueue(now);
		const paired = assertMatchInvariants(matches, now);

		for (const id of cancelledIds) {
			expect(paired.has(id)).toBe(false);
			expect(matchmakingService.getQueueStatus(id)).toBeNull();
		}

		// Conservation: matched players + still-queued players = surviving players.
		expect(paired.size + matchmakingService.getQueueSize()).toBe(80);
	});

	test("cancelling mid-evaluation leaves queue state consistent", async () => {
		const now = Date.now();
		const tickets = buildTickets(now);
		await enqueueAll(tickets);

		// Cancel part of the queue between two evaluation rounds.
		const firstRound = matchmakingService.processQueue(now);
		const secondWave = tickets.slice(0, 30);
		await Promise.all(secondWave.map((t) => matchmakingService.addToQueue(t)));
		const cancelledWave = secondWave.slice(0, 10);
		cancelledWave.forEach((t) => matchmakingService.removeFromQueue(t.userId));
		const secondRound = matchmakingService.processQueue(now);

		expect(firstRound).toHaveLength(50);
		const cancelledIds = new Set(cancelledWave.map((t) => t.userId));
		for (const match of secondRound) {
			expect(cancelledIds.has(match.player1.userId)).toBe(false);
			expect(cancelledIds.has(match.player2.userId)).toBe(false);
		}
		// Every surviving re-queued entrant is either matched or still waiting.
		const secondPaired = secondRound.length * 2;
		expect(secondPaired + matchmakingService.getQueueSize()).toBe(20);
	});

	test("cancelling an unknown or already matched ticket is a safe no-op", async () => {
		const now = Date.now();
		const tickets = buildTickets(now);
		await enqueueAll(tickets);
		matchmakingService.processQueue(now);

		expect(matchmakingService.removeFromQueue("does-not-exist")).toBe(false);
		expect(matchmakingService.removeFromQueue(tickets[0].ticketId)).toBe(false);
		expect(matchmakingService.getQueueSize()).toBe(0);
	});

	test("re-queuing the same player 100 times keeps a single ticket", async () => {
		const now = Date.now();
		await Promise.all(
			Array.from({ length: 100 }, async (_, i) =>
				matchmakingService.addToQueue({
					userId: "REPEAT",
					socketId: `repeat-socket-${i}`,
					elo: 1500,
					wagerTier: "low",
					queuedAt: now - FULLY_EXPANDED_WAIT_MS,
				})
			)
		);

		expect(matchmakingService.getQueueSize()).toBe(1);
		expect(matchmakingService.processQueue(now)).toEqual([]);
	});

	describe("queue worker lifecycle", () => {
		test("worker drains 100 entrants into 50 matches and leaves no timers behind", async () => {
			jest.useFakeTimers();
			const now = Date.now();
			await enqueueAll(shuffle(buildTickets(now), createRng(6)));

			const matches = [];
			matchmakingService.startQueueWorker({
				onMatch: (match) => matches.push(match),
				intervalMs: 100,
			});
			expect(jest.getTimerCount()).toBe(1);

			jest.advanceTimersByTime(100);

			expect(matches).toHaveLength(50);
			expect(assertMatchInvariants(matches, Date.now()).size).toBe(100);
			expect(matchmakingService.getQueueSize()).toBe(0);

			// Further ticks must not produce duplicate pairings.
			jest.advanceTimersByTime(1000);
			expect(matches).toHaveLength(50);

			matchmakingService.stopQueueWorker();
			expect(matchmakingService.pollTimer).toBeNull();
			expect(jest.getTimerCount()).toBe(0);
		});

		test("a throwing onMatch handler does not drop the remaining pairings", async () => {
			jest.useFakeTimers();
			const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
			try {
				const now = Date.now();
				await enqueueAll(buildTickets(now));

				let calls = 0;
				matchmakingService.startQueueWorker({
					onMatch: () => {
						calls++;
						if (calls === 1) throw new Error("handler failure");
					},
					intervalMs: 100,
				});
				jest.advanceTimersByTime(100);

				expect(calls).toBe(50);
				expect(errorSpy).toHaveBeenCalledTimes(1);
			} finally {
				errorSpy.mockRestore();
			}
		});

		test("restarting the worker replaces the previous timer instead of stacking", () => {
			jest.useFakeTimers();
			const onMatch = jest.fn();

			matchmakingService.startQueueWorker({ onMatch, intervalMs: 50 });
			matchmakingService.startQueueWorker({ onMatch, intervalMs: 50 });
			expect(jest.getTimerCount()).toBe(1);

			matchmakingService.stopQueueWorker();
			expect(jest.getTimerCount()).toBe(0);
		});

		test("stopping a worker that was never started is safe", () => {
			expect(() => matchmakingService.stopQueueWorker()).not.toThrow();
			expect(matchmakingService.pollTimer).toBeNull();
		});
	});

	test("repeated enqueue and cancel cycles do not leak queue entries", async () => {
		const now = Date.now();
		for (let round = 0; round < 20; round++) {
			const tickets = buildTickets(now).map((t) => ({ ...t, userId: `${t.userId}-r${round}` }));
			await enqueueAll(tickets);
			await Promise.all(tickets.map(async (t) => matchmakingService.removeFromQueue(t.userId)));
			expect(matchmakingService.getQueueSize()).toBe(0);
		}
	});
});
