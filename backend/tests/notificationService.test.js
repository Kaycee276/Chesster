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
		delete process.env.COMMUNITY_WEBHOOK_URL;
		delete process.env.APP_URL;
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

describe("broadcastHighWagerAlert", () => {
	const highWagerGame = {
		white_player: "Magnus",
		black_player: "Hikaru",
		wager_amount: "150",
		game_code: "ABC123",
		time_control: "10+0",
	};

	afterEach(() => {
		delete process.env.COMMUNITY_WEBHOOK_URL;
		delete process.env.APP_URL;
	});

	test("posts a correctly structured Discord embed for a high-wager match", async () => {
		process.env.COMMUNITY_WEBHOOK_URL = "https://discord.test/community-hook";
		process.env.APP_URL = "https://chesster.app";
		const http = { post: jest.fn().mockResolvedValue({ data: {} }) };
		const service = new NotificationService({ http });

		const result = await service.broadcastHighWagerAlert(highWagerGame);

		expect(result).toEqual({ sent: true });
		expect(http.post).toHaveBeenCalledTimes(1);
		expect(http.post).toHaveBeenCalledWith(
			"https://discord.test/community-hook",
			{
				embeds: [
					expect.objectContaining({
						title: "⚔️ High-Stakes Match Created!",
						url: "https://chesster.app/game/ABC123",
						color: 0x10b981,
						fields: expect.arrayContaining([
							{ name: "Players", value: "Magnus vs Hikaru", inline: true },
							{ name: "Wager", value: "150 XLM", inline: true },
							{ name: "Time Control", value: "10+0", inline: true },
						]),
					}),
				],
			},
			expect.objectContaining({ timeout: 3000 }),
		);
	});

	test("returns sent:false and makes no HTTP call when wager is below threshold", async () => {
		process.env.COMMUNITY_WEBHOOK_URL = "https://discord.test/community-hook";
		const http = { post: jest.fn() };
		const service = new NotificationService({ http });

		const result = await service.broadcastHighWagerAlert({ ...highWagerGame, wager_amount: "50" });

		expect(result).toEqual({ sent: false });
		expect(http.post).not.toHaveBeenCalled();
	});

	test("returns sent:false and makes no HTTP call when COMMUNITY_WEBHOOK_URL is not set", async () => {
		const http = { post: jest.fn() };
		const service = new NotificationService({ http });

		const result = await service.broadcastHighWagerAlert(highWagerGame);

		expect(result).toEqual({ sent: false });
		expect(http.post).not.toHaveBeenCalled();
	});

	test("swallows HTTP errors without throwing so match flow is unaffected", async () => {
		process.env.COMMUNITY_WEBHOOK_URL = "https://discord.test/community-hook";
		const http = { post: jest.fn().mockRejectedValue(new Error("network timeout")) };
		const service = new NotificationService({ http });

		await expect(service.broadcastHighWagerAlert(highWagerGame)).resolves.not.toThrow();
	});

	test("uses Open Lobby label when black_player is absent", async () => {
		process.env.COMMUNITY_WEBHOOK_URL = "https://discord.test/community-hook";
		const http = { post: jest.fn().mockResolvedValue({ data: {} }) };
		const service = new NotificationService({ http });

		await service.broadcastHighWagerAlert({ ...highWagerGame, black_player: null });

		const [, body] = http.post.mock.calls[0];
		expect(body.embeds[0].description).toContain("Open Lobby");
	});

	test("omits Time Control field when not provided", async () => {
		process.env.COMMUNITY_WEBHOOK_URL = "https://discord.test/community-hook";
		const http = { post: jest.fn().mockResolvedValue({ data: {} }) };
		const service = new NotificationService({ http });

		const gameWithoutTimeControl = { ...highWagerGame };
		delete gameWithoutTimeControl.time_control;
		await service.broadcastHighWagerAlert(gameWithoutTimeControl);

		const [, body] = http.post.mock.calls[0];
		const fieldNames = body.embeds[0].fields.map((f) => f.name);
		expect(fieldNames).not.toContain("Time Control");
	});
});
