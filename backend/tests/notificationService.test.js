const { NotificationService } = require("../services/notificationService");

describe("NotificationService", () => {
	const tournament = {
		id: "tournament-1",
		name: "Friday Open",
		prizePool: "250",
		participantCount: 32,
		startsAt: "2026-09-24T18:00:00.000Z",
	};

	afterEach(() => {
		delete process.env.RESEND_API_KEY;
		delete process.env.DISCORD_WEBHOOK_URL;
	});

	test("posts a rich Discord embed payload", async () => {
		const http = { post: jest.fn().mockResolvedValue({ data: {} }) };
		const service = new NotificationService({ http });
		const embed = service.buildReminderEmbed(tournament, 15);

		await service.sendDiscordAnnouncement("https://discord.test/hook", embed);

		expect(http.post).toHaveBeenCalledWith(
			"https://discord.test/hook",
			{ embeds: [expect.objectContaining({
				title: "Tournament Starting Soon: Friday Open",
				url: "https://chesster.io/tournaments/tournament-1",
				fields: [
					{ name: "Prize Pool", value: "250 XLM", inline: true },
					{ name: "Participants", value: "32", inline: true },
				],
			})] },
			{ timeout: 10000 },
		);
	});

	test("sends a Resend tournament reminder email", async () => {
		process.env.RESEND_API_KEY = "resend-test-key";
		const http = { post: jest.fn().mockResolvedValue({ data: { id: "email-1" } }) };
		const service = new NotificationService({ http });

		await expect(service.sendTournamentReminderEmail("player@example.com", tournament, 5))
			.resolves.toEqual({ channel: "email", sent: true, id: "email-1" });
		expect(http.post).toHaveBeenCalledWith(
			"https://api.resend.com/emails",
			expect.objectContaining({
				to: ["player@example.com"],
				subject: "Friday Open starts in 5 minutes",
			}),
			expect.objectContaining({
				headers: expect.objectContaining({ Authorization: "Bearer resend-test-key" }),
			}),
		);
	});

	test("isolates failed recipients while delivering remaining alerts", async () => {
		process.env.RESEND_API_KEY = "resend-test-key";
		const http = {
			post: jest.fn()
				.mockRejectedValueOnce(new Error("invalid recipient"))
				.mockResolvedValueOnce({ data: { id: "email-2" } }),
		};
		const service = new NotificationService({ http });

		const result = await service.sendTournamentAlerts(
			tournament,
			["bad@example.com", "good@example.com"],
			15,
		);

		expect(result.sent).toBe(true);
		expect(result.results.map((entry) => entry.status)).toEqual(["rejected", "fulfilled"]);
	});
});
