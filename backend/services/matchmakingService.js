class MatchmakingService {
	constructor() {
		// Map<userId, { userId, socketId, elo, wagerTier, joinedAt }>
		this.queue = new Map();
		this.defaultElo = 1200;
		this.defaultMaxEloDiff = 100;
		this.eloExpansionRate = 10; // rating points per second in queue
	}

	/**
	 * Add a player to the matchmaking queue.
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

		const parsedElo = Number.isInteger(elo) && elo > 0 ? elo : this.defaultElo;
		const entry = {
			userId: String(userId),
			socketId: String(socketId),
			elo: parsedElo,
			wagerTier: String(wagerTier || "free").toLowerCase(),
			joinedAt: Date.now(),
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
	 * Find a matching opponent for a given player already in or entering the queue.
	 * @param {object} player - queue entry or player object with { userId, elo, wagerTier }
	 * @param {number} baseMaxEloDiff - maximum allowed Elo difference (default 100)
	 * @returns {object|null} { player1, player2 } if match found, else null
	 */
	findMatch(player, baseMaxEloDiff = this.defaultMaxEloDiff) {
		if (!player || !player.userId) return null;

		const targetUserId = String(player.userId);
		const targetTier = String(player.wagerTier || "free").toLowerCase();
		const targetElo = Number.isInteger(player.elo) && player.elo > 0 ? player.elo : this.defaultElo;
		const targetJoinedAt = player.joinedAt || Date.now();

		let bestMatch = null;
		let lowestEloDiff = Infinity;

		for (const candidate of this.queue.values()) {
			if (candidate.userId === targetUserId) continue;
			if (candidate.wagerTier !== targetTier) continue;

			const eloDiff = Math.abs(targetElo - candidate.elo);

			// Calculate dynamic Elo window based on how long candidate and player have been queued
			const now = Date.now();
			const candidateWaitSec = Math.max(0, (now - candidate.joinedAt) / 1000);
			const targetWaitSec = Math.max(0, (now - targetJoinedAt) / 1000);
			const maxWaitSec = Math.max(candidateWaitSec, targetWaitSec);

			const effectiveMaxDiff = baseMaxEloDiff + Math.floor(maxWaitSec * this.eloExpansionRate);

			if (eloDiff <= effectiveMaxDiff && eloDiff < lowestEloDiff) {
				lowestEloDiff = eloDiff;
				bestMatch = candidate;
			}
		}

		if (bestMatch) {
			const p1 = this.queue.get(targetUserId) || player;
			const p2 = bestMatch;

			this.removeFromQueue(p1.userId);
			this.removeFromQueue(p2.userId);

			return { player1: p1, player2: p2 };
		}

		return null;
	}

	/**
	 * Scan the queue and pair all eligible players.
	 * @returns {Array<{player1: object, player2: object}>} list of matched pairs
	 */
	processQueue() {
		const matches = [];
		const candidates = Array.from(this.queue.values());

		for (const candidate of candidates) {
			if (!this.queue.has(candidate.userId)) continue;
			const match = this.findMatch(candidate);
			if (match) {
				matches.push(match);
			}
		}

		return matches;
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

		return {
			...entry,
			waitTimeSeconds: Math.floor((Date.now() - entry.joinedAt) / 1000),
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
}

module.exports = new MatchmakingService();
module.exports.MatchmakingService = MatchmakingService;
