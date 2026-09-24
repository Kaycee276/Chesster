const supabase = require("../config/supabase");
const notificationService = require("./notificationService");

class CronService {
	constructor({ db = supabase, notifications = notificationService } = {}) {
		this.db = db;
		this.notifications = notifications;
		this.isRunning = false;
		this.cronIntervalMs = 60 * 1000;
		this.cleanupIntervalMs = 60 * 60 * 1000;
		this.cleanupThresholdHours = 24;
		this.lastCleanupAt = 0;
		this.cronHandle = null;
	}

	async cleanupAbandonedLobbies() {
		try {
			const thresholdTime = new Date(Date.now() - this.cleanupThresholdHours * 60 * 60 * 1000).toISOString();
			const { data: expiredGames, error: fetchError } = await this.db
				.from("games")
				.select("id, game_code, created_at")
				.eq("status", "waiting")
				.lt("created_at", thresholdTime)
				.limit(100);
			if (fetchError) return { success: false, error: fetchError.message };
			if (!expiredGames?.length) return { success: true, cleaned: 0 };

			const { error: updateError } = await this.db
				.from("games")
				.update({ status: "expired" })
				.in("id", expiredGames.map((game) => game.id));
			if (updateError) return { success: false, error: updateError.message };
			return { success: true, cleaned: expiredGames.length };
		} catch (error) {
			return { success: false, error: error.message };
		}
	}

	async getTournamentReminders(minutes, now = new Date()) {
		const targetMs = now.getTime() + minutes * 60 * 1000;
		const sentColumn = minutes === 15 ? "reminder_15m_sent_at" : "reminder_5m_sent_at";
		const { data, error } = await this.db
			.from("tournaments")
			.select("id, name, starts_at, prize_pool")
			.in("status", ["draft", "open"])
			.is(sentColumn, null)
			.gte("starts_at", new Date(targetMs - 30000).toISOString())
			.lte("starts_at", new Date(targetMs + 30000).toISOString());
		if (error) throw error;
		return data || [];
	}

	async getRecipientEmails(tournamentId) {
		const { data: participants, error: participantError } = await this.db
			.from("tournament_participants")
			.select("wallet_address")
			.eq("tournament_id", tournamentId)
			.eq("status", "active");
		if (participantError) throw participantError;
		const wallets = (participants || []).map((participant) => participant.wallet_address);
		if (wallets.length === 0) return { participantCount: 0, emails: [] };

		const { data: users, error: userError } = await this.db
			.from("users")
			.select("email")
			.in("wallet_address", wallets);
		if (userError) throw userError;
		return {
			participantCount: wallets.length,
			emails: (users || []).map((user) => user.email).filter(Boolean),
		};
	}

	async dispatchTournamentReminders(minutes, now = new Date()) {
		const tournaments = await this.getTournamentReminders(minutes, now);
		const sentColumn = minutes === 15 ? "reminder_15m_sent_at" : "reminder_5m_sent_at";
		const results = [];

		for (const row of tournaments) {
			const recipients = await this.getRecipientEmails(row.id);
			const tournament = {
				id: row.id,
				name: row.name,
				startsAt: row.starts_at,
				prizePool: String(row.prize_pool || 0),
				participantCount: recipients.participantCount,
			};
			const delivery = await this.notifications.sendTournamentAlerts(tournament, recipients.emails, minutes);
			if (delivery.sent) {
				await this.db.from("tournaments").update({ [sentColumn]: now.toISOString() }).eq("id", row.id);
			}
			results.push({ tournamentId: row.id, ...delivery });
		}
		return results;
	}

	async dispatchWinnerAnnouncements(now = new Date()) {
		const { data, error } = await this.db
			.from("tournaments")
			.select("id, name, winner_address, prize_pool")
			.eq("status", "completed")
			.is("winner_announced_at", null)
			.not("winner_address", "is", null)
			.limit(50);
		if (error) throw error;

		for (const row of data || []) {
			const delivery = await this.notifications.sendTournamentWinnerAnnouncement({
				id: row.id,
				name: row.name,
				winnerAddress: row.winner_address,
				prizePool: String(row.prize_pool || 0),
			});
			if (delivery.sent) {
				await this.db.from("tournaments").update({ winner_announced_at: now.toISOString() }).eq("id", row.id);
			}
		}
		return data || [];
	}

	async runScheduledTasks(now = new Date()) {
		const tasks = [
			this.dispatchTournamentReminders(15, now),
			this.dispatchTournamentReminders(5, now),
			this.dispatchWinnerAnnouncements(now),
		];
		if (now.getTime() - this.lastCleanupAt >= this.cleanupIntervalMs) {
			this.lastCleanupAt = now.getTime();
			tasks.push(this.cleanupAbandonedLobbies());
		}
		return Promise.allSettled(tasks);
	}

	start() {
		if (this.isRunning) return;
		this.isRunning = true;
		this.runScheduledTasks();
		this.cronHandle = setInterval(() => this.runScheduledTasks(), this.cronIntervalMs);
	}

	stop() {
		if (this.cronHandle) clearInterval(this.cronHandle);
		this.cronHandle = null;
		this.isRunning = false;
	}

	getStatus() {
		return {
			isRunning: this.isRunning,
			intervalMs: this.cronIntervalMs,
			cleanupThresholdHours: this.cleanupThresholdHours,
		};
	}

	setCleanupInterval(intervalMs) {
		this.cleanupIntervalMs = intervalMs;
	}

	setCleanupThreshold(hours) {
		this.cleanupThresholdHours = hours;
	}
}

module.exports = new CronService();
module.exports.CronService = CronService;
