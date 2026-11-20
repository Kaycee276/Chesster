/**
 * MatchmakingService
 *
 * In-memory Elo matchmaking queue with time-decayed rating tolerance
 * ("bucket expansion"). A freshly queued player only accepts opponents within
 * ±50 rating points; every 15 seconds of waiting widens that window by another
 * 50 points, up to a hard ceiling of 350 so long waits never produce wildly
 * unfair pairings.
 *
 * Two players are paired only when their mutual tolerances allow it: the
 * rating gap must fit inside BOTH players' current windows. Among all eligible
 * pairs, the closest ratings are paired first.
 *
 * Distributed queue (Issue #644): the same pairing rules also run on a Redis
 * Streams queue so several server replicas can share one matchmaking pool.
 * Tickets are written with XADD to stream:matchmaking:queue and delivered to
 * workers through the consumer group group:matchmakers (XREADGROUP). A ticket
 * stays in the group's pending list (the waiting pool) until two players are
 * matched, at which point both are acknowledged with a single atomic XACK.
 * Tickets left pending for 60 seconds are claimed (XPENDING / XCLAIM), moved to
 * stream:matchmaking:dead-letter and reported to the client as expired.
 * Double booking is prevented by a per-wallet SET NX claim taken before the XACK.
 */

const BASE_TOLERANCE = 50; // rating points accepted on entering the queue
const TOLERANCE_STEP = 50; // extra rating points per expansion step
const EXPANSION_INTERVAL_SEC = 15; // seconds of waiting per expansion step
const MAX_RATING_GAP = 350; // hard ceiling for any pairing
const DEFAULT_POLL_INTERVAL_MS = 1000;

// Issue #644: Redis Streams distributed matchmaking queue.
const MATCHMAKING_STREAM_KEY = "stream:matchmaking:queue";
const MATCHMAKING_CONSUMER_GROUP = "group:matchmakers";
const MATCHMAKING_DEAD_LETTER_KEY = "stream:matchmaking:dead-letter";
const TICKET_EXPIRY_MS = 60_000; // unacknowledged tickets older than this are dead-lettered
const WALLET_CLAIM_PREFIX = "lock:matchmaking:wallet:";
const WALLET_CLAIM_TTL_MS = 10_000;
const MAX_POOL_TICKETS = 200; // pending tickets considered per worker iteration
const DEFAULT_READ_COUNT = 10;

// Issue #552: Skill-based matchmaking (SBMM) expansion windows over wait time
const SBMM_BASE_TOLERANCE = 75;
const SBMM_MAX_TOLERANCE = 400;
const SBMM_STEP = 75;
const EXPANSION_THRESHOLDS_SEC = [15, 30, 45];

/**
 * Calculate dynamic Elo tolerance window over wait time (Issue #552):
 * - 0-15s: 75 Elo
 * - 16-30s: 150 Elo
 * - 31-45s: 250 Elo (or 75 + steps * 75 capped at 400)
 *
 * @param {number} queuedAt - Timestamp when the player/ticket entered the queue
 * @param {number} [baseTolerance=75]
 * @param {number} [maxTolerance=400]
 * @param {number} [now=Date.now()]
 * @returns {number}
 */
function calculateEloTolerance(queuedAt, baseTolerance = SBMM_BASE_TOLERANCE, maxTolerance = SBMM_MAX_TOLERANCE, now = Date.now()) {
	const elapsedSeconds = Math.max(0, (now - queuedAt) / 1000);
	const steps = Math.floor(elapsedSeconds / 15);
	const expanded = baseTolerance + steps * SBMM_STEP;
	return Math.min(expanded, maxTolerance);
}

/**
 * Current rating tolerance for a queue entry:
 *   min(350, 50 + floor(waitSeconds / 15) * 50)
 *
 * @param {{ queuedAt: number }} entry
 * @param {number} [now=Date.now()]
 * @returns {number}
 */
function getPlayerTolerance(entry, now = Date.now()) {
	const waitSeconds = Math.max(0, (now - entry.queuedAt) / 1000);
	const expansionSteps = Math.floor(waitSeconds / EXPANSION_INTERVAL_SEC);
	return Math.min(MAX_RATING_GAP, BASE_TOLERANCE + expansionSteps * TOLERANCE_STEP);
}

class MatchmakingService {
	constructor() {
		// Map<userId, { userId, socketId, elo, wagerTier, queuedAt }>
		this.queue = new Map();
		this.defaultElo = 1200;
		this.maxRatingGap = MAX_RATING_GAP;
		this.pollTimer = null;
		this._pairedGames = [];
		this._pairedPlayerIds = new Set();
		this.redis = null;
		this.streamTimer = null;
	}

	/**
	 * Add a player to the matchmaking queue. Re-queuing a player who is already
	 * waiting in the same wager tier and asset (e.g. after a socket reconnect) keeps their
	 * original queuedAt so they do not lose their accumulated tolerance.
	 * @param {object} player - { userId, socketId, elo, wagerTier, timeControl, wagerAsset, ticketId, timeoutMs }
	 * @returns {object} queue entry
	 */
	addToQueue({
		userId,
		socketId,
		elo,
		wagerTier = "free",
		timeControl = null,
		wagerAsset = null,
		ticketId = null,
		timeoutMs = null,
	}) {
		if (!userId) {
			throw new Error("userId is required for matchmaking");
		}
		if (!socketId) {
			throw new Error("socketId is required for matchmaking");
		}

		const id = String(userId);
		const tier = String(wagerTier || "free").toLowerCase();
		const asset = wagerAsset ? String(wagerAsset).toUpperCase() : null;
		const tc = timeControl ? String(timeControl) : null;
		const tid = ticketId ? String(ticketId) : null;
		const existing = this.queue.get(id);
		const sameTier = existing && existing.wagerTier === tier;
		const sameAsset = existing && (existing.wagerAsset || null) === asset;
		const sameTimeControl = existing && (existing.timeControl || null) === tc;

		const entry = {
			userId: id,
			socketId: String(socketId),
			elo: this._normalizeElo(elo),
			wagerTier: tier,
			queuedAt: (arguments[0] && arguments[0].queuedAt) || (sameTier && sameAsset && sameTimeControl ? existing.queuedAt : Date.now()),
		};

		if (tid) entry.ticketId = tid;
		if (asset !== null) entry.wagerAsset = asset;
		if (tc !== null) entry.timeControl = tc;
		if (typeof timeoutMs === "number") entry.timeoutMs = timeoutMs;

		this.queue.set(entry.userId, entry);
		return entry;
	}

	/**
	 * Remove a player from the queue by userId or ticketId.
	 * @param {string} userIdOrTicketId
	 * @returns {boolean} true if removed, false otherwise
	 */
	removeFromQueue(userIdOrTicketId) {
		if (!userIdOrTicketId) return false;
		const target = String(userIdOrTicketId);
		if (this.queue.delete(target)) return true;
		for (const [userId, entry] of this.queue.entries()) {
			if (entry.ticketId === target) {
				this.queue.delete(userId);
				return true;
			}
		}
		return false;
	}

	/**
	 * Explicit ticket cancellation helper (Issue #556).
	 * Removes ticket from queue and cancels any pending timeouts.
	 * @param {string} ticketId
	 * @returns {boolean} true if removed, false otherwise
	 */
	cancelMatchmakingTicket(ticketId) {
		return this.removeFromQueue(ticketId);
	}

	/**
	 * Remove tickets that have exceeded their timeoutMs duration.
	 * @param {number} [now=Date.now()]
	 * @param {(entry: object) => void} [onTimeout]
	 * @returns {Array<object>} list of removed expired tickets
	 */
	cleanupExpiredTickets(now = Date.now(), onTimeout = null) {
		const expired = [];
		for (const [userId, entry] of this.queue.entries()) {
			if (entry.timeoutMs && now - entry.queuedAt >= entry.timeoutMs) {
				this.queue.delete(userId);
				expired.push(entry);
				if (typeof onTimeout === "function") {
					try {
						onTimeout(entry);
					} catch (err) {
						console.error("Matchmaking onTimeout handler failed:", err);
					}
				}
			}
		}
		return expired;
	}

	/**
	 * Remove a player from the queue by socketId.
	 * @param {string} socketId
	 * @returns {boolean} true if removed, false otherwise
	 */
	removeFromQueueBySocket(socketId) {
		if (!socketId) return false;
		for (const [userId, entry] of this.queue.entries()) {
			if (entry.socketId === String(socketId)) {
				this.queue.delete(userId);
				return true;
			}
		}
		return false;
	}

	/**
	 * Whether two queue entries may be paired at time `now`: same wager tier,
	 * compatible wager asset, matching time control, and a rating gap within
	 * acceptable tolerances and the hard ceiling.
	 *
	 * When useMaxTolerance is true (Issue #552):
	 *   |Elo1 - Elo2| <= Math.max(Tolerance(P1), Tolerance(P2))
	 * Otherwise mutual tolerance requires:
	 *   |Elo1 - Elo2| <= Math.min(Tolerance(P1), Tolerance(P2))
	 *
	 * @param {object} a
	 * @param {object} b
	 * @param {number} [now=Date.now()]
	 * @param {boolean} [useMaxTolerance=false]
	 * @returns {boolean}
	 */
	canPair(a, b, now = Date.now(), useMaxTolerance = false) {
		if (a.userId === b.userId) return false;
		if (a.wagerTier !== b.wagerTier) return false;
		if ((a.wagerAsset || null) !== (b.wagerAsset || null)) return false;
		if ((a.timeControl || null) !== (b.timeControl || null)) return false;
		const gap = Math.abs(a.elo - b.elo);
		const tolA = getPlayerTolerance(a, now);
		const tolB = getPlayerTolerance(b, now);
		const allowedTolerance = useMaxTolerance ? Math.max(tolA, tolB) : Math.min(tolA, tolB);
		return gap <= Math.min(allowedTolerance, this.maxRatingGap);
	}

	/**
	 * Check queue entries for wait-time expansion thresholds (15s, 30s, 45s)
	 * and invoke onExpand / notify client if crossed. (Issue #552)
	 *
	 * @param {number} [now=Date.now()]
	 * @param {Function} [onExpand]
	 * @returns {Array<object>} list of triggered expansion notifications
	 */
	checkQueueExpansions(now = Date.now(), onExpand = null) {
		const expansions = [];
		for (const entry of this.queue.values()) {
			const elapsedSec = Math.floor(Math.max(0, now - entry.queuedAt) / 1000);
			if (!entry.expandedThresholds) {
				entry.expandedThresholds = new Set();
			}

			for (const threshold of EXPANSION_THRESHOLDS_SEC) {
				if (elapsedSec >= threshold && !entry.expandedThresholds.has(threshold)) {
					entry.expandedThresholds.add(threshold);
					const currentRadius = calculateEloTolerance(entry.queuedAt, SBMM_BASE_TOLERANCE, SBMM_MAX_TOLERANCE, now);
					const payload = {
						userId: entry.userId,
						socketId: entry.socketId,
						ticketId: entry.ticketId || null,
						thresholdSeconds: threshold,
						elapsedSeconds: elapsedSec,
						searchRadius: currentRadius,
					};
					expansions.push(payload);
					if (typeof onExpand === "function") {
						try {
							onExpand(payload);
						} catch (err) {
							console.error("Matchmaking onExpand handler failed:", err);
						}
					}
				}
			}
		}
		return expansions;
	}

	/**
	 * Find and claim the closest eligible opponent for a player. Ties on rating
	 * gap go to the opponent who has waited longest.
	 * @param {object} player - queue entry or player object with { userId, elo, wagerTier }
	 * @param {number} [now=Date.now()]
	 * @returns {object|null} { player1, player2 } if match found, else null
	 */
	findMatch(player, now = Date.now()) {
		if (!player || !player.userId) return null;

		const target = this.queue.get(String(player.userId)) || {
			userId: String(player.userId),
			elo: this._normalizeElo(player.elo),
			wagerTier: String(player.wagerTier || "free").toLowerCase(),
			wagerAsset: player.wagerAsset ? String(player.wagerAsset).toUpperCase() : null,
			timeControl: player.timeControl ? String(player.timeControl) : null,
			queuedAt: player.queuedAt || now,
		};

		let bestMatch = null;
		for (const candidate of this.queue.values()) {
			if (!this.canPair(target, candidate, now)) continue;
			if (!bestMatch || this._isBetterOpponent(target, candidate, bestMatch)) {
				bestMatch = candidate;
			}
		}

		if (!bestMatch) return null;

		this.removeFromQueue(target.userId);
		this.removeFromQueue(bestMatch.userId);
		const matchCode = this.generateMatchCode();
		return {
			matchCode,
			round: 1,
			player1: target,
			player2: bestMatch,
		};
	}

	/**
	 * Generate a unique match code.
	 * @returns {string}
	 */
	generateMatchCode() {
		return `MATCH_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
	}

	/**
	 * Scan the queue and pair every eligible player, closest rating gaps first.
	 * Ties on rating gap go to the pair containing the longest-waiting player.
	 * @param {number} [now=Date.now()]
	 * @returns {Array<{matchCode: string, round: number, player1: object, player2: object}>} list of matched pairs
	 */
	processQueue(now = Date.now()) {
		this.cleanupExpiredTickets(now);
		const tiers = new Map();
		for (const entry of this.queue.values()) {
			const groupKey = `${entry.wagerTier}:${entry.wagerAsset || "DEFAULT"}:${entry.timeControl || "DEFAULT"}`;
			if (!tiers.has(groupKey)) tiers.set(groupKey, []);
			tiers.get(groupKey).push(entry);
		}

		const candidatePairs = [];
		for (const entries of tiers.values()) {
			entries.sort((a, b) => a.elo - b.elo);
			for (let i = 0; i < entries.length; i++) {
				for (let j = i + 1; j < entries.length; j++) {
					// Sorted by rating: once the gap exceeds the ceiling, no later
					// entry can pair with entries[i].
					if (entries[j].elo - entries[i].elo > this.maxRatingGap) break;
					if (this.canPair(entries[i], entries[j], now)) {
						candidatePairs.push([entries[i], entries[j]]);
					}
				}
			}
		}

		candidatePairs.sort(
			([a1, b1], [a2, b2]) =>
				Math.abs(a1.elo - b1.elo) - Math.abs(a2.elo - b2.elo) ||
				Math.min(a1.queuedAt, b1.queuedAt) - Math.min(a2.queuedAt, b2.queuedAt)
		);

		const matches = [];
		for (const [a, b] of candidatePairs) {
			if (!this.queue.has(a.userId) || !this.queue.has(b.userId)) continue;
			this.removeFromQueue(a.userId);
			this.removeFromQueue(b.userId);
			const matchCode = this.generateMatchCode();
			// The longer-waiting player is listed first.
			const pair = a.queuedAt <= b.queuedAt ? { player1: a, player2: b } : { player1: b, player2: a };
			matches.push({
				matchCode,
				round: 1,
				...pair,
			});
		}

		return matches;
	}

	/**
	 * Start polling the queue so tolerances widen and waiting players get
	 * paired without needing a new player to join.
	 * @param {object} options
	 * @param {(match: {player1: object, player2: object}) => void} options.onMatch
	 * @param {(expansion: object) => void} [options.onExpand]
	 * @param {number} [options.intervalMs=1000]
	 */
	startQueueWorker({ onMatch, onExpand = null, intervalMs = DEFAULT_POLL_INTERVAL_MS } = {}) {
		if (typeof onMatch !== "function") {
			throw new Error("onMatch callback is required to start the matchmaking worker");
		}
		this.stopQueueWorker();

		this.pollTimer = setInterval(() => {
			if (typeof onExpand === "function") {
				this.checkQueueExpansions(Date.now(), onExpand);
			}
			for (const match of this.processQueue()) {
				try {
					onMatch(match);
				} catch (err) {
					// One failing handler must not drop the remaining pairings.
					console.error("Matchmaking onMatch handler failed:", err);
				}
			}
		}, intervalMs);

		// Do not keep the process alive just for matchmaking polling.
		if (typeof this.pollTimer.unref === "function") this.pollTimer.unref();
	}

	/**
	 * Stop the queue polling worker, if running.
	 */
	stopQueueWorker() {
		if (this.pollTimer) {
			clearInterval(this.pollTimer);
			this.pollTimer = null;
		}
	}

	/**
	 * Get current queue status for a user.
	 * @param {string} userId
	 * @returns {object|null} queue entry or null
	 */
	getQueueStatus(userId) {
		if (!userId) return null;
		const entry = this.queue.get(String(userId));
		if (!entry) return null;

		const now = Date.now();
		return {
			...entry,
			waitTimeSeconds: Math.floor((now - entry.queuedAt) / 1000),
			ratingTolerance: getPlayerTolerance(entry, now),
		};
	}

	/**
	 * Get total queue size or count per wager tier.
	 * @param {string|null} wagerTier
	 * @returns {number}
	 */
	getQueueSize(wagerTier = null) {
		if (!wagerTier) {
			return this.queue.size;
		}

		const targetTier = String(wagerTier).toLowerCase();
		let count = 0;
		for (const entry of this.queue.values()) {
			if (entry.wagerTier === targetTier) {
				count++;
			}
		}
		return count;
	}

	/**
	 * Clear the entire matchmaking queue.
	 */
	clearQueue() {
		this.queue.clear();
		this._pairedGames = [];
		this._pairedPlayerIds = new Set();
	}

	/**
	 * High-level helper for joining queue and finding immediate matches.
	 */
	async joinQueue(walletAddress, elo) {
		const id = String(walletAddress);
		if (this.queue.has(id)) {
			return this.queue.get(id);
		}
		if (this._pairedPlayerIds && this._pairedPlayerIds.has(id)) {
			return { userId: id, elo };
		}
		const entry = {
			userId: id,
			socketId: `socket_${id}`,
			elo: this._normalizeElo(elo),
			wagerTier: "free",
			queuedAt: Date.now(),
		};

		let bestMatch = null;
		for (const candidate of this.queue.values()) {
			if (!this.canPair(entry, candidate)) continue;
			if (!bestMatch || this._isBetterOpponent(entry, candidate, bestMatch)) {
				bestMatch = candidate;
			}
		}

		if (bestMatch) {
			this.queue.delete(bestMatch.userId);
			this._pairedGames = this._pairedGames || [];
			this._pairedPlayerIds = this._pairedPlayerIds || new Set();
			this._pairedPlayerIds.add(entry.userId);
			this._pairedPlayerIds.add(bestMatch.userId);
			this._pairedGames.push({
				id: this.generateMatchCode(),
				players: [entry.userId, bestMatch.userId],
			});
			return entry;
		}

		this.queue.set(id, entry);
		return entry;
	}

	async leaveQueue(walletAddress) {
		const id = String(walletAddress);
		const removed = this.removeFromQueue(id);
		if (this._pairedPlayerIds) {
			this._pairedPlayerIds.delete(id);
		}
		return removed;
	}

	getPairedGames() {
		return this._pairedGames || [];
	}

	getPairedCount() {
		return (this._pairedGames || []).length * 2;
	}

	getQueueState() {
		return Array.from(this.queue.values());
	}

	clearMatches() {
		this._pairedGames = [];
		this._pairedPlayerIds = new Set();
	}

	// ------------------------------------------------------------------
	// Redis Streams distributed queue (Issue #644)
	// ------------------------------------------------------------------

	/**
	 * Use `redisClient` (an ioredis-compatible client) for the stream queue.
	 * Blocking reads (blockMs > 0) hold the connection, so give workers their
	 * own client rather than sharing the application cache connection.
	 */
	setRedis(redisClient) {
		this.redis = redisClient || null;
	}

	_requireRedis(redis) {
		const client = redis || this.redis;
		if (!client) throw new Error("A Redis client is required for the matchmaking stream queue");
		return client;
	}

	/** Create the consumer group (and the stream) if they do not exist yet. Idempotent. */
	async ensureConsumerGroup(redis = null) {
		const client = this._requireRedis(redis);
		try {
			// "0" so tickets written before the group existed are still delivered.
			await client.xgroup("CREATE", MATCHMAKING_STREAM_KEY, MATCHMAKING_CONSUMER_GROUP, "0", "MKSTREAM");
		} catch (err) {
			if (!String((err && err.message) || "").includes("BUSYGROUP")) throw err;
		}
	}

	/**
	 * Write a matchmaking ticket to the stream (XADD).
	 * @param {{wallet: string, rating: number, timeControl?: string, wagerAmount?: number|string,
	 *   wagerTier?: string, wagerAsset?: string, enqueuedAt?: number}} ticketData
	 * @returns {Promise<string>} stream entry id
	 */
	async enqueueTicket(ticketData, redis = null) {
		const client = this._requireRedis(redis);
		const { wallet, rating, timeControl, wagerAmount, wagerTier, wagerAsset, enqueuedAt } = ticketData || {};
		if (!wallet) throw new Error("wallet is required for a matchmaking ticket");
		if (!Number.isFinite(Number(rating))) throw new Error("rating must be a number");

		const fields = [
			"wallet", String(wallet),
			"rating", String(Number(rating)),
			"timeControl", timeControl ? String(timeControl) : "",
			"wagerAmount", String(wagerAmount ?? 0),
			"wagerTier", String(wagerTier || "free").toLowerCase(),
			"wagerAsset", wagerAsset ? String(wagerAsset).toUpperCase() : "",
			"enqueuedAt", String(enqueuedAt ?? Date.now()),
		];
		return client.xadd(MATCHMAKING_STREAM_KEY, "*", ...fields);
	}

	/**
	 * Cancel a waiting ticket (acknowledge it out of the pending list and delete it).
	 * @returns {Promise<boolean>} true when the ticket was pending or still in the stream
	 */
	async cancelTicket(streamId, redis = null) {
		const client = this._requireRedis(redis);
		const acked = await client.xack(MATCHMAKING_STREAM_KEY, MATCHMAKING_CONSUMER_GROUP, streamId);
		const deleted = await client.xdel(MATCHMAKING_STREAM_KEY, streamId);
		return Number(acked) > 0 || Number(deleted) > 0;
	}

	/**
	 * Fetch new tickets for this consumer atomically (XREADGROUP). Each entry is
	 * delivered to exactly one consumer in the group and stays pending until acked.
	 * @returns {Promise<object[]>} parsed tickets
	 */
	async consumeTickets(consumerName, { count = DEFAULT_READ_COUNT, blockMs = 2000, redis = null } = {}) {
		const client = this._requireRedis(redis);
		const args = ["GROUP", MATCHMAKING_CONSUMER_GROUP, consumerName, "COUNT", count];
		if (blockMs > 0) args.push("BLOCK", blockMs);
		args.push("STREAMS", MATCHMAKING_STREAM_KEY, ">");
		const reply = await client.xreadgroup(...args);
		const tickets = [];
		for (const [, entries] of reply || []) {
			for (const entry of entries) tickets.push({ ...this._parseTicket(entry), consumer: consumerName });
		}
		return tickets;
	}

	/** Convert a raw stream entry [id, [field, value, ...]] into a queue-compatible ticket. */
	_parseTicket([streamId, flat]) {
		const raw = {};
		for (let i = 0; i < (flat || []).length; i += 2) raw[flat[i]] = flat[i + 1];
		const elo = Number(raw.rating);
		const queuedAt = Number(raw.enqueuedAt);
		return {
			streamId,
			userId: raw.wallet ? String(raw.wallet) : "",
			elo: Number.isFinite(elo) ? Math.round(elo) : NaN,
			timeControl: raw.timeControl || null,
			wagerAmount: raw.wagerAmount ?? "0",
			wagerTier: String(raw.wagerTier || "free").toLowerCase(),
			wagerAsset: raw.wagerAsset || null,
			queuedAt: Number.isFinite(queuedAt) ? queuedAt : Date.now(),
			raw,
		};
	}

	_isValidTicket(ticket) {
		return Boolean(ticket.userId) && Number.isFinite(ticket.elo) && ticket.elo > 0;
	}

	/** Every waiting ticket in the group (pending for any consumer), oldest first. */
	async _loadWaitingPool(client) {
		const pending = await client.xpending(MATCHMAKING_STREAM_KEY, MATCHMAKING_CONSUMER_GROUP, "-", "+", MAX_POOL_TICKETS);
		const pool = [];
		for (const [id, consumer, idleMs] of pending || []) {
			const entries = await client.xrange(MATCHMAKING_STREAM_KEY, id, id);
			if (!entries || entries.length === 0) {
				// Deleted (cancelled) while pending: drop the dangling reference.
				await client.xack(MATCHMAKING_STREAM_KEY, MATCHMAKING_CONSUMER_GROUP, id);
				continue;
			}
			pool.push({ ...this._parseTicket(entries[0]), consumer, idleMs: Number(idleMs) });
		}
		return pool;
	}

	/** Copy a ticket to the dead-letter stream, acknowledge it and notify the client. */
	async _deadLetter(client, ticket, reason, onExpired) {
		await client.xadd(
			MATCHMAKING_DEAD_LETTER_KEY, "*",
			...Object.entries(ticket.raw || {}).flat(),
			"originalId", ticket.streamId,
			"reason", reason,
			"deadLetteredAt", String(Date.now()),
		);
		await client.xack(MATCHMAKING_STREAM_KEY, MATCHMAKING_CONSUMER_GROUP, ticket.streamId);
		if (typeof onExpired === "function") {
			try {
				onExpired(ticket, { reason });
			} catch (err) {
				console.error("Matchmaking onExpired handler failed:", err);
			}
		}
	}

	/** Same pairing rules as the in-memory queue, plus an exact wager amount match. */
	_canPairTickets(a, b, now) {
		return String(a.wagerAmount) === String(b.wagerAmount) && this.canPair(a, b, now);
	}

	/**
	 * Take the per-wallet claims then acknowledge both tickets with one atomic
	 * XACK. Returns true only when this worker now exclusively owns the match.
	 */
	async _claimPair(client, a, b, consumerName) {
		const wallets = [a.userId, b.userId].sort();
		const held = [];
		const releaseAll = async () => {
			for (const key of held) await client.del(key);
		};
		for (const wallet of wallets) {
			const key = WALLET_CLAIM_PREFIX + wallet;
			const ok = await client.set(key, consumerName, "PX", WALLET_CLAIM_TTL_MS, "NX");
			if (!ok) {
				await releaseAll();
				return false;
			}
			held.push(key);
		}

		// Both tickets must still be waiting (not matched, cancelled or expired meanwhile).
		for (const ticket of [a, b]) {
			const still = await client.xpending(MATCHMAKING_STREAM_KEY, MATCHMAKING_CONSUMER_GROUP, ticket.streamId, ticket.streamId, 1);
			if (!still || still.length === 0) {
				await releaseAll();
				return false;
			}
		}

		const acked = Number(await client.xack(MATCHMAKING_STREAM_KEY, MATCHMAKING_CONSUMER_GROUP, a.streamId, b.streamId));
		if (acked === 2) return true; // wallet claims expire on their own, shielding duplicate tickets

		// Another actor acknowledged one of them between the check and the XACK.
		// Put the pair back rather than lose a waiting player.
		console.error(`[Matchmaking] Partial acknowledgement (${acked}/2); re-enqueuing tickets`);
		await releaseAll();
		for (const ticket of [a, b]) {
			await this.enqueueTicket({ ...ticket.raw, wallet: ticket.userId, rating: ticket.elo, enqueuedAt: ticket.queuedAt }, client);
		}
		return false;
	}

	/**
	 * One worker iteration: read new tickets, pair the waiting pool (closest
	 * ratings first, longest wait breaking ties) and acknowledge matches.
	 * A worker only initiates pairs that include one of its own tickets; the
	 * claim step makes concurrent workers safe.
	 * @param {string} consumerName
	 * @param {{count?: number, blockMs?: number, now?: number, onExpired?: Function, redis?: object}} [options]
	 * @returns {Promise<Array<{matchCode: string, round: number, player1: object, player2: object}>>}
	 */
	async processStreamQueue(consumerName, { count = DEFAULT_READ_COUNT, blockMs = 0, now = Date.now(), onExpired = null, redis = null } = {}) {
		const client = this._requireRedis(redis);
		await this.ensureConsumerGroup(client);
		const delivered = await this.consumeTickets(consumerName, { count, blockMs, redis: client });
		for (const ticket of delivered) {
			if (!this._isValidTicket(ticket)) await this._deadLetter(client, ticket, "invalid_ticket", onExpired);
		}

		const pool = (await this._loadWaitingPool(client)).filter((ticket) => this._isValidTicket(ticket));
		const groups = new Map();
		for (const ticket of pool) {
			const key = `${ticket.wagerTier}:${ticket.wagerAsset || "DEFAULT"}:${ticket.timeControl || "DEFAULT"}:${ticket.wagerAmount}`;
			if (!groups.has(key)) groups.set(key, []);
			groups.get(key).push(ticket);
		}

		const candidates = [];
		for (const tickets of groups.values()) {
			tickets.sort((x, y) => x.elo - y.elo);
			for (let i = 0; i < tickets.length; i++) {
				for (let j = i + 1; j < tickets.length; j++) {
					if (tickets[j].elo - tickets[i].elo > this.maxRatingGap) break;
					const mine = tickets[i].consumer === consumerName || tickets[j].consumer === consumerName;
					if (mine && this._canPairTickets(tickets[i], tickets[j], now)) candidates.push([tickets[i], tickets[j]]);
				}
			}
		}
		candidates.sort(
			([a1, b1], [a2, b2]) =>
				Math.abs(a1.elo - b1.elo) - Math.abs(a2.elo - b2.elo) ||
				Math.min(a1.queuedAt, b1.queuedAt) - Math.min(a2.queuedAt, b2.queuedAt),
		);

		const matches = [];
		const used = new Set();
		for (const [a, b] of candidates) {
			if (used.has(a.streamId) || used.has(b.streamId)) continue;
			if (!(await this._claimPair(client, a, b, consumerName))) continue;
			used.add(a.streamId);
			used.add(b.streamId);
			const pair = a.queuedAt <= b.queuedAt ? { player1: a, player2: b } : { player1: b, player2: a };
			matches.push({ matchCode: this.generateMatchCode(), round: 1, ...pair });
		}
		return matches;
	}

	/**
	 * Dead-letter monitor: claim tickets pending longer than `minIdleMs`
	 * (XPENDING / XCLAIM), copy them to the dead-letter stream, acknowledge them
	 * and report each one through `onExpired` so the client can be told. Covers
	 * both unmatched waiting players and tickets stranded by a crashed worker.
	 * @returns {Promise<object[]>} the expired tickets
	 */
	async recoverStaleTickets(consumerName, { minIdleMs = TICKET_EXPIRY_MS, onExpired = null, redis = null } = {}) {
		const client = this._requireRedis(redis);
		await this.ensureConsumerGroup(client);
		const pending = await client.xpending(MATCHMAKING_STREAM_KEY, MATCHMAKING_CONSUMER_GROUP, "-", "+", MAX_POOL_TICKETS);
		const staleIds = (pending || []).filter(([, , idleMs]) => Number(idleMs) >= minIdleMs).map(([id]) => id);
		if (staleIds.length === 0) return [];

		// XCLAIM re-checks the idle time, so a ticket another worker just claimed is skipped.
		const claimed = await client.xclaim(MATCHMAKING_STREAM_KEY, MATCHMAKING_CONSUMER_GROUP, consumerName, minIdleMs, ...staleIds);
		const expired = [];
		for (const entry of claimed || []) {
			if (!entry) continue;
			const ticket = { ...this._parseTicket(entry), consumer: consumerName };
			await this._deadLetter(client, ticket, "expired_unmatched", onExpired);
			expired.push(ticket);
		}
		return expired;
	}

	/**
	 * Start the stream worker loop for this replica. Runs a pairing iteration
	 * then an expiry sweep, repeating every `intervalMs`.
	 * @param {object} options
	 * @param {string} options.consumerName - unique per replica/worker
	 * @param {(match: object) => void} options.onMatch
	 * @param {(ticket: object, info: {reason: string}) => void} [options.onExpired]
	 */
	startStreamWorker({ consumerName, onMatch, onExpired = null, intervalMs = DEFAULT_POLL_INTERVAL_MS, blockMs = 0, redis = null } = {}) {
		if (!consumerName) throw new Error("consumerName is required to start the matchmaking stream worker");
		if (typeof onMatch !== "function") throw new Error("onMatch callback is required to start the matchmaking stream worker");
		this._requireRedis(redis);
		this.stopStreamWorker();

		let running = false;
		const tick = async () => {
			if (running) return; // never overlap iterations
			running = true;
			try {
				for (const match of await this.processStreamQueue(consumerName, { blockMs, onExpired, redis })) {
					try {
						onMatch(match);
					} catch (err) {
						console.error("Matchmaking onMatch handler failed:", err);
					}
				}
				await this.recoverStaleTickets(consumerName, { onExpired, redis });
			} catch (err) {
				console.error("Matchmaking stream worker iteration failed:", err.message);
			} finally {
				running = false;
			}
		};
		this.streamTimer = setInterval(tick, intervalMs);
		if (typeof this.streamTimer.unref === "function") this.streamTimer.unref();
		return tick;
	}

	stopStreamWorker() {
		if (this.streamTimer) {
			clearInterval(this.streamTimer);
			this.streamTimer = null;
		}
	}

	_normalizeElo(elo) {
		return Number.isInteger(elo) && elo > 0 ? elo : this.defaultElo;
	}

	// True when `candidate` is a better opponent for `target` than `current`.
	_isBetterOpponent(target, candidate, current) {
		const candidateGap = Math.abs(target.elo - candidate.elo);
		const currentGap = Math.abs(target.elo - current.elo);
		if (candidateGap !== currentGap) return candidateGap < currentGap;
		return candidate.queuedAt < current.queuedAt;
	}
}

module.exports = new MatchmakingService();
module.exports.MatchmakingService = MatchmakingService;
module.exports.getPlayerTolerance = getPlayerTolerance;
module.exports.calculateEloTolerance = calculateEloTolerance;
module.exports.EXPANSION_THRESHOLDS_SEC = EXPANSION_THRESHOLDS_SEC;
module.exports.STREAM_CONFIG = Object.freeze({
	STREAM_KEY: MATCHMAKING_STREAM_KEY,
	CONSUMER_GROUP: MATCHMAKING_CONSUMER_GROUP,
	DEAD_LETTER_KEY: MATCHMAKING_DEAD_LETTER_KEY,
	TICKET_EXPIRY_MS,
	WALLET_CLAIM_TTL_MS,
});
module.exports.MATCHMAKING_CONFIG = Object.freeze({
	BASE_TOLERANCE,
	TOLERANCE_STEP,
	EXPANSION_INTERVAL_SEC,
	MAX_RATING_GAP,
});
module.exports.SBMM_CONFIG = Object.freeze({
	BASE_TOLERANCE: SBMM_BASE_TOLERANCE,
	MAX_TOLERANCE: SBMM_MAX_TOLERANCE,
	TOLERANCE_STEP: SBMM_STEP,
	EXPANSION_THRESHOLDS_SEC,
});
