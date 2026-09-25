const { createClient } = require("redis");

class SessionService {
	constructor() {
		this.revokedAfter = new Map();
		this.client = null;
		this.connecting = null;
	}

	async getClient() {
		if (!process.env.REDIS_URL) return null;
		if (this.client?.isReady) return this.client;
		if (this.connecting) return this.connecting;

		this.client = createClient({ url: process.env.REDIS_URL });
		this.client.on("error", (error) => {
			console.error("[SessionService] Redis error:", error.message);
		});
		this.connecting = this.client
			.connect()
			.then(() => this.client)
			.catch((error) => {
				console.error("[SessionService] Redis unavailable, using local revocation state:", error.message);
				return null;
			})
			.finally(() => {
				this.connecting = null;
			});
		return this.connecting;
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
			await client.set(this.key(address), String(revokedAt));
		}
		return revokedAt;
	}

	async isTokenRevoked(address, issuedAtSeconds) {
		if (!address || !issuedAtSeconds) return true;
		let revokedAt = this.revokedAfter.get(address) || 0;
		const client = await this.getClient();
		if (client) {
			const stored = Number(await client.get(this.key(address))) || 0;
			revokedAt = Math.max(revokedAt, stored);
		}
		return issuedAtSeconds * 1000 <= revokedAt;
	}

	resetLocalState() {
		this.revokedAfter.clear();
	}
}

module.exports = new SessionService();
module.exports.SessionService = SessionService;
