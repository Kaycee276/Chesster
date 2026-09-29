const { getRedisConnection } = require("../config/redis");

class SessionService {
	constructor() {
		this.revokedAfter = new Map();
	}

	async getClient() {
		return getRedisConnection();
	}

	key(address) {
		return `auth:revoked-after:${address}`;
	}

	async revokeAll(address) {
		const revokedAt = Date.now();
		this.revokedAfter.set(address, revokedAt);
		const client = await this.getClient();
		if (client) {
			// Account deletion is permanent, and JWT lifetime is configurable. Keep
			// the cutoff until an explicit account-restoration flow removes it.
			try {
				await client.set(this.key(address), String(revokedAt));
			} catch (error) {
				console.warn("[SessionService] Redis revocation write failed; using local state:", error.message);
			}
		}
		return revokedAt;
	}

	async isTokenRevoked(address, issuedAtSeconds) {
		if (!address || !issuedAtSeconds) return true;
		let revokedAt = this.revokedAfter.get(address) || 0;
		const client = await this.getClient();
		if (client) {
			try {
				const stored = Number(await client.get(this.key(address))) || 0;
				revokedAt = Math.max(revokedAt, stored);
			} catch (error) {
				console.warn("[SessionService] Redis revocation read failed; using local state:", error.message);
			}
		}
		return issuedAtSeconds * 1000 <= revokedAt;
	}

	resetLocalState() {
		this.revokedAfter.clear();
	}
}

module.exports = new SessionService();
module.exports.SessionService = SessionService;
