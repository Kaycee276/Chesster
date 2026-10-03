const supabase = require("../config/supabase");
const notificationService = require("./notificationService");
const archivalService = require("./archivalService");
const { refreshTorExitList } = require("../middlewares/proxyDetection");
const eloService = require("./eloService");

class CronService {
	constructor({ db = supabase, notifications = notificationService, archival = archivalService, escrow = null, game = null } = {}) {
		this.db = db;
		this.notifications = notifications;
		this.archival = archival;
		// null means "use the real module, resolved lazily on first call" — avoids
		// pulling @stellar/stellar-sdk into the module graph at require() time so
		// test suites that don't need escrow don't need to mock it.
		this._escrow = escrow;
		this._game = game;
		this.isRunning = false;
		this.cronIntervalMs = 60 * 1000;
		this.cleanupIntervalMs = 60 * 60 * 1000;
		this.cleanupThresholdHours = 24;
		this.cleanupBatchSize = 100;
		this.lastCleanupAt = 0;
		this.lastTorRefreshAt = 0;
		this.torRefreshIntervalMs = 24 * 60 * 60 * 1000; // 24 hours
		this.archivalIntervalMs = 7 * 24 * 60 * 60 * 1000;
		this.archivalAgeDays = 90;
		this.cronHandle = null;
		this.archivalHandle = null;
	}

	get escrow() {
		if (!this._escrow) this._escrow = require("./escrowService");
		return this._escrow;
	}

	get game() {
		if (!this._game) this._game = require("../models/gameModel");
		return this._game;
	}

	async refreshTorNodes() {
		try {
			return await refreshTorExitList();
		} catch (error) {
			console.error("[CronService] Tor exit nodes refresh failed:", error.message);
			return { success: false, error: error.message };
		}
	}

	async archiveCompletedGames() {
		const cutoffDate = new Date(Date.now() - this.archivalAgeDays * 24 * 60 * 60 * 1000);
		try {
			if (this.archival && typeof this.archival.archiveOldGames === "function") {
				return await this.archival.archiveOldGames(cutoffDate);
			}
			return { success: true, archived: 0 };
		} catch (error) {
			console.error("[CronService] Game archival failed:", error.message);
			return { success: false, error: error.message };
		}
	}

	async cleanupAbandonedLobbies() {
		try {
			const thresholdTime = new Date(Date.now() - this.cleanupThresholdHours * 60 * 60 * 1000).toISOString();

			// ── Phase 1: Atomically claim expired waiting lobbies ───────────────
			// claimExpiredWaitingLobbies performs a two-step read-then-update where
			// the UPDATE re-asserts status='waiting', so any lobby that was
			// concurrently joined (status → 'active') before this UPDATE lands is
			// silently skipped.  The function also sets escrow_refund_status='none'
			// for newly expired wagered lobbies so they enter the refund queue.
			let claimed;
			try {
				claimed = await this.game.claimExpiredWaitingLobbies(thresholdTime, this.cleanupBatchSize);
			} catch (claimErr) {
				console.error("[CronService] claimExpiredWaitingLobbies failed:", claimErr.message);
				return { success: false, error: claimErr.message };
			}

			// ── Phase 2: Pick up any previously failed/pending refunds ──────────
			// These are expired wagered lobbies from earlier cleanup runs whose
			// refund attempt failed or whose process crashed mid-flight.
			let retryBatch = [];
			try {
				retryBatch = await this.game.getPendingLobbyRefunds(this.cleanupBatchSize);
			} catch (retryErr) {
				// Non-fatal: log and continue with the fresh batch only.
				console.warn("[CronService] getPendingLobbyRefunds failed (will retry next tick):", retryErr.message);
			}

			// Deduplicate: merge newly claimed + retry candidates, avoiding
			// double-processing if the same row appears in both sets.
			const seenIds = new Set();
			const refundCandidates = [];
			for (const row of [...claimed, ...retryBatch]) {
				if (!seenIds.has(row.id)) {
					seenIds.add(row.id);
					refundCandidates.push(row);
				}
			}

			const newlyCleaned = claimed.length;
			let refundSucceeded = 0;
			let refundFailed = 0;
			const failures = [];

			// ── Phase 3: Issue on-chain refunds for wagered expired lobbies ─────
			for (const lobby of refundCandidates) {
				// Only attempt refund for wagered lobbies whose on-chain escrow is
				// still in the 'pending' deposit state (player1 deposited, player2
				// never joined) and whose refund has not already succeeded.
				if (
					!lobby.wager_amount ||
					lobby.escrow_status !== "pending" ||
					lobby.escrow_refund_status === "succeeded"
				) {
					continue;
				}

				// Mark in-flight *before* the network call so a crash/restart won't
				// lose track of this attempt; the row is retried on next tick if it
				// stays 'pending' without resolving.
				try {
					await this.game.updateLobbyRefundStatus(lobby.id, "pending");
				} catch (markErr) {
					console.warn(`[CronService] Failed to mark refund pending for ${lobby.game_code}:`, markErr.message);
					// Continue — we'll retry this lobby on the next tick regardless.
					continue;
				}

				try {
					const receipt = await this.escrow.refundUnresolvedMatch(lobby.game_code);
					await this.game.updateLobbyRefundStatus(lobby.id, "succeeded", receipt?.hash ?? null);
					refundSucceeded++;
					console.log(`[CronService] Refunded abandoned wagered lobby ${lobby.game_code} — tx: ${receipt?.hash}`);
				} catch (refundErr) {
					refundFailed++;
					const errMsg = refundErr?.message ?? String(refundErr);
					failures.push({ game_code: lobby.game_code, error: errMsg });
					try {
						await this.game.updateLobbyRefundStatus(lobby.id, "failed");
					} catch (writeErr) {
						console.warn(`[CronService] Could not persist refund failure for ${lobby.game_code}:`, writeErr.message);
					}
					console.error(`[CronService] Refund failed for abandoned lobby ${lobby.game_code}:`, errMsg);
				}
			}

			const result = {
				success: true,
				cleaned: newlyCleaned,
				refundSucceeded,
				refundFailed,
			};
			if (failures.length > 0) {
				result.failures = failures;
			}
			return result;
		} catch (error) {
			return { success: false, error: error.message };
		}
	}

	async decayInactiveRatingDeviation(now = new Date()) {
		const cutoff = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
		const { data: players, error } = await this.db.from("players")
			.select("wallet_address, elo_rating, rating_deviation, volatility, updated_at")
			.lt("updated_at", cutoff).limit(500);
		if (error) return { success: false, error: error.message };
		for (const player of players || []) {
			const inactiveSeconds = Math.max(0, (now.getTime() - new Date(player.updated_at).getTime()) / 1000);
			const next = eloService.inflateRatingDeviation(player, inactiveSeconds);
			await this.db.from("players").update({ rating_deviation: next.ratingDeviation }).eq("wallet_address", player.wallet_address);
		}
		return { success: true, updated: (players || []).length };
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
		tasks.push(this.decayInactiveRatingDeviation(now));
		if (now.getTime() - this.lastCleanupAt >= this.cleanupIntervalMs) {
			this.lastCleanupAt = now.getTime();
			tasks.push(this.cleanupAbandonedLobbies());
		}
		if (now.getTime() - this.lastTorRefreshAt >= this.torRefreshIntervalMs) {
			this.lastTorRefreshAt = now.getTime();
			tasks.push(this.refreshTorNodes());
		}
		return Promise.allSettled(tasks);
	}

	start() {
		if (this.isRunning) return;
		this.isRunning = true;
		this.runScheduledTasks();
		this.cronHandle = setInterval(() => this.runScheduledTasks(), this.cronIntervalMs);
		this.archivalHandle = setInterval(() => this.archiveCompletedGames(), this.archivalIntervalMs);
	}

	stop() {
		if (this.cronHandle) clearInterval(this.cronHandle);
		if (this.archivalHandle) clearInterval(this.archivalHandle);
		this.cronHandle = null;
		this.archivalHandle = null;
		this.isRunning = false;
	}

	getStatus() {
		return {
			isRunning: this.isRunning,
			intervalMs: this.cronIntervalMs,
			cleanupThresholdHours: this.cleanupThresholdHours,
			archivalIntervalMs: this.archivalIntervalMs,
			archivalAgeDays: this.archivalAgeDays,
			torRefreshIntervalMs: this.torRefreshIntervalMs,
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
