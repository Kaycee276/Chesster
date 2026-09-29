const axios = require("axios");

function escapeHtml(value) {
	return String(value)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#039;");
}

class NotificationService {
	constructor({ http = axios } = {}) {
		this.http = http;
	}

	async sendDiscordAnnouncement(channelUrl, embed) {
		if (!channelUrl) throw new Error("Discord webhook URL is required");
		if (!embed || !embed.title) throw new Error("Discord embed title is required");
		await this.http.post(channelUrl, { embeds: [embed] }, { timeout: 10000 });
		return { channel: "discord", sent: true };
	}

	async sendTournamentReminderEmail(recipientEmail, tournament, reminderMinutes) {
		if (!recipientEmail) throw new Error("Recipient email is required");
		if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured");

		const tournamentUrl = this.getTournamentUrl(tournament.id);
		const response = await this.http.post(
			"https://api.resend.com/emails",
			{
				from: process.env.TOURNAMENT_EMAIL_FROM || "Chesster <tournaments@chesster.io>",
				to: [recipientEmail],
				subject: `${tournament.name} starts in ${reminderMinutes} minutes`,
				html: [
					`<h1>${escapeHtml(tournament.name)}</h1>`,
					`<p>Your tournament starts in ${reminderMinutes} minutes.</p>`,
					`<p>Prize pool: <strong>${escapeHtml(tournament.prizePool)} XLM</strong></p>`,
					`<p><a href="${escapeHtml(tournamentUrl)}">Open tournament</a></p>`,
				].join(""),
			},
			{
				headers: {
					Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
					"Content-Type": "application/json",
				},
				timeout: 10000,
			},
		);
		return { channel: "email", sent: true, id: response.data?.id };
	}

	getTournamentUrl(tournamentId) {
		return `${(process.env.APP_URL || "https://chesster.io").replace(/\/$/, "")}/tournaments/${tournamentId}`;
	}

	buildReminderEmbed(tournament, reminderMinutes) {
		return {
			title: `Tournament Starting Soon: ${tournament.name}`,
			description: `Starts in **${reminderMinutes} minutes**`,
			color: 0xf59e0b,
			url: this.getTournamentUrl(tournament.id),
			fields: [
				{ name: "Prize Pool", value: `${tournament.prizePool} XLM`, inline: true },
				{ name: "Participants", value: String(tournament.participantCount), inline: true },
			],
			timestamp: new Date(tournament.startsAt).toISOString(),
		};
	}

	async sendTournamentAlerts(tournament, recipientEmails, reminderMinutes) {
		const tasks = [];
		if (process.env.DISCORD_WEBHOOK_URL) {
			tasks.push(this.sendDiscordAnnouncement(
				process.env.DISCORD_WEBHOOK_URL,
				this.buildReminderEmbed(tournament, reminderMinutes),
			));
		}
		for (const email of new Set(recipientEmails.filter(Boolean))) {
			tasks.push(this.sendTournamentReminderEmail(email, tournament, reminderMinutes));
		}

		if (tasks.length === 0) return { sent: false, results: [] };
		const results = await Promise.allSettled(tasks);
		return {
			sent: results.some((result) => result.status === "fulfilled"),
			results,
		};
	}

	async sendTournamentWinnerAnnouncement(tournament) {
		if (!process.env.DISCORD_WEBHOOK_URL) return { sent: false };
		const embed = {
			title: `Tournament Champion: ${tournament.name}`,
			description: `Congratulations to **${tournament.winnerAddress}**`,
			color: 0x22c55e,
			url: this.getTournamentUrl(tournament.id),
			fields: [{ name: "Prize Pool", value: `${tournament.prizePool} XLM`, inline: true }],
			timestamp: new Date().toISOString(),
		};
		await this.sendDiscordAnnouncement(process.env.DISCORD_WEBHOOK_URL, embed);
		return { sent: true };
	}
}

module.exports = new NotificationService();
module.exports.NotificationService = NotificationService;
module.exports.escapeHtml = escapeHtml;
