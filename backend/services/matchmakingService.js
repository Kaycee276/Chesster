/**
 * MatchmakingService
 *
 * In-memory Elo matchmaking queue with time-decayed rating tolerance
 * ("bracket expansion"). A freshly queued player only accepts opponents within
 * ±50 rating points. As a player waits, the window expands at specific time
 * boundaries (10s, 25s, 45s) in exponential steps (50 → 100 → 200 → 400),
 * capped at ±400 to prevent wildly unfair pairings.
 *
 * Two players are paired only when their mutual tolerances allow it: the
 * rating gap must fit inside BOTH players' current windows. Among all eligible
 * pairs, the closest ratings are paired first.
 */

const MAX_RATING_GAP = 400; // hard ceiling for any pairing (±400)
const DEFAULT_POLL_INTERVAL_MS = 1000;

/**
 * Compute the eligible rating delta for a queue entry based on wait time.
 * This implements exponential bracket expansion at specific time boundaries:
 *   - 0s to <10s:   ±50
 *   - 10s to <25s:  ±100
 *   - 25s to <45s:  ±200
 *   - 45s+:         ±400
 *
 * Boundary behavior (exact values):
 *   - At exactly 10s, the bracket is ±100 (upper boundary is included)
 *   - At exactly 25s, the bracket is ±200 (upper boundary is included)
 *   - At exactly 45s, the bracket is ±400 (upper boundary is included)
 *
 * @param {number} waitSeconds - Seconds the player has been in the queue
 * @returns {number} Rating delta in ±points
 */
function getEligibleRatingDelta(waitSeconds) {
	if (waitSeconds < 10) return 50;
	if (waitSeconds < 25) return 100;
	if (waitSeconds < 45) return 200;
	return 400;
}

/**
 * Current rating tolerance for a queue entry:
 * Uses getEligibleRatingDelta() to determine the bracket, then caps at MAX_RATING_GAP.
 *
 * @param {{ queuedAt: number }} entry
 * @param {number} [now=Date.now()]
 * @returns {number}
 */
function getPlayerTolerance(entry, now = Date.now()) {
	const waitSeconds = Math.max(0, (now - entry.queuedAt) / 1000);
	return Math.min(MAX_RATING_GAP, getEligibleRatingDelta(waitSeconds));
}

class MatchmakingService {
	constructor() {
		// Map<userId, { userId, socketId, elo, wagerTier, queuedAt }>
		this.queue = new Map();
		this.defaultElo = 1200;
		this.maxRatingGap = MAX_RATING_GAP;
		this.pollTimer = null;
	}

	/**
	 * Add a player to the matchmaking queue. Re-queuing a player who is already
	 * waiting in the same wager tier (e.g. after a socket reconnect) keeps their
	 * original queuedAt so they do not lose their accumulated tolerance.
	 * @param {object} player - { userId, socketId, elo, wagerTier }
	 * @returns {object} queue entry
	 */
	addToQueue({ userId, socketId, elo, wagerTier = "free" }) {
		if (!userId) {
			throw new Error("userId is required for matchmaking");
		}
		if (!socketId) {
			throw new Error("socketId is required for matchmaking");
		}

		const id = String(userId);
		const tier = String(wagerTier || "free").toLowerCase();
		const existing = this.queue.get(id);

		const entry = {
			userId: id,
			socketId: String(socketId),
			elo: this._normalizeElo(elo),
			wagerTier: tier,
			queuedAt: existing && existing.wagerTier === tier ? existing.queuedAt : Date.now(),
		};

		this.queue.set(entry.userId, entry);
		return entry;
	}

	/**
	 * Remove a player from the queue by userId.
	 * @param {string} userId
	 * @returns {boolean} true if removed, false otherwise
	 */
	removeFromQueue(userId) {
		if (!userId) return false;
		return this.queue.delete(String(userId));
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
	 * and a rating gap within both players' tolerances and the hard ceiling.
	 * @returns {boolean}
	 */
	canPair(a, b, now = Date.now()) {
		if (a.userId === b.userId || a.wagerTier !== b.wagerTier) return false;
		const gap = Math.abs(a.elo - b.elo);
		const mutualTolerance = Math.min(getPlayerTolerance(a, now), getPlayerTolerance(b, now));
		return gap <= Math.min(mutualTolerance, this.maxRatingGap);
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
		return { player1: target, player2: bestMatch };
	}

	/**
	 * Scan the queue and pair every eligible player, closest rating gaps first.
	 * Ties on rating gap go to the pair containing the longest-waiting player.
	 * @param {number} [now=Date.now()]
	 * @returns {Array<{player1: object, player2: object}>} list of matched pairs
	 */
	processQueue(now = Date.now()) {
		const tiers = new Map();
		for (const entry of this.queue.values()) {
			if (!tiers.has(entry.wagerTier)) tiers.set(entry.wagerTier, []);
			tiers.get(entry.wagerTier).push(entry);
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
			// The longer-waiting player is listed first.
			matches.push(a.queuedAt <= b.queuedAt ? { player1: a, player2: b } : { player1: b, player2: a });
		}

		return matches;
	}

	/**
	 * Start polling the queue so tolerances widen and waiting players get
	 * paired without needing a new player to join.
	 * @param {object} options
	 * @param {(match: {player1: object, player2: object}) => void} options.onMatch
	 * @param {number} [options.intervalMs=1000]
	 */
	startQueueWorker({ onMatch, intervalMs = DEFAULT_POLL_INTERVAL_MS } = {}) {
		if (typeof onMatch !== "function") {
			throw new Error("onMatch callback is required to start the matchmaking worker");
		}
		this.stopQueueWorker();

		this.pollTimer = setInterval(() => {
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
module.exports.getEligibleRatingDelta = getEligibleRatingDelta;
module.exports.MATCHMAKING_CONFIG = Object.freeze({
	MAX_RATING_GAP,
});
