const eventBus = require("../services/eventBus");
const eloService = require("../services/eloService");
const webhookService = require("../services/webhookService");
const supabase = require("../config/supabase");

class EventConsumer {
	constructor({ bus = eventBus, elo = eloService, webhooks = webhookService, db = supabase, logger = console } = {}) {
		this.bus = bus;
		this.elo = elo;
		this.webhooks = webhooks;
		this.db = db;
		this.logger = logger;
		this.started = false;
		this.unsubscribe = [];
	}

	async _findPlayerIds(payload) {
		const wallets = [payload.playerWhiteAddress, payload.playerBlackAddress].filter(Boolean);
		if (wallets.length !== 2) return null;
		const { data, error } = await this.db
			.from("users")
			.select("id, wallet_address")
			.in("wallet_address", wallets);
		if (error) throw error;

		const byWallet = new Map((data || []).map((user) => [user.wallet_address, user.id]));
		const whiteId = byWallet.get(payload.playerWhiteAddress);
		const blackId = byWallet.get(payload.playerBlackAddress);
		if (!whiteId || !blackId) return null;

		let winnerId = null;
		if (payload.winner === "white") winnerId = whiteId;
		if (payload.winner === "black") winnerId = blackId;
		return { whiteId, blackId, winnerId };
	}

	async updateElo(payload) {
		const players = await this._findPlayerIds(payload);
		if (!players) return { skipped: true, reason: "player profiles unavailable" };
		return this.elo.updateEloRatings(players.whiteId, players.blackId, players.winnerId, this.db);
	}

	async archiveEvent(envelope) {
		if (!envelope.payload.gameId) return { skipped: true, reason: "game id unavailable" };
		const { error } = await this.db.from("match_audit_logs").insert({
			game_id: envelope.payload.gameId,
			event_type: envelope.type,
			event_data: envelope.payload,
			player_address: envelope.payload.winnerAddress || null,
		});
		if (error) throw error;
		return { archived: true };
	}

	async handleGameEnded(envelope) {
		const results = await Promise.allSettled([
			this.updateElo(envelope.payload),
			this.webhooks.notifyMatchResolved(envelope.payload),
			this.archiveEvent(envelope),
		]);

		results.forEach((result, index) => {
			if (result.status === "rejected") {
				const task = ["elo", "webhook", "audit"][index];
				this.logger.error(`[EventConsumer] ${task} task failed: ${result.reason.message}`);
			}
		});
		return results;
	}

	async handlePlayerRegistered(envelope) {
		return this.webhooks.dispatch(envelope.type, envelope.payload);
	}

	async start() {
		if (this.started) return;
		this.unsubscribe.push(
			await this.bus.subscribe("game.ended", (event) => this.handleGameEnded(event)),
			await this.bus.subscribe("player.registered", (event) => this.handlePlayerRegistered(event)),
		);
		this.started = true;
	}

	stop() {
		this.unsubscribe.splice(0).forEach((unsubscribe) => unsubscribe());
		this.started = false;
	}
}

module.exports = new EventConsumer();
module.exports.EventConsumer = EventConsumer;
