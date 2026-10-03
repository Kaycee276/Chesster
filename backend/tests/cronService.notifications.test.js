jest.mock("../config/supabase", () => ({}));

const { CronService } = require("../services/cronService");

describe("CronService tournament notifications", () => {
	test.each([15, 5])("dispatches and marks the %i-minute reminder", async (minutes) => {
		const now = new Date("2026-09-24T17:45:00.000Z");
		const updateEq = jest.fn().mockResolvedValue({ error: null });
		const db = {
			from: jest.fn(() => ({
				update: jest.fn(() => ({ eq: updateEq })),
			})),
		};
		const notifications = {
			sendTournamentAlerts: jest.fn().mockResolvedValue({ sent: true, results: [] }),
		};
		const service = new CronService({ db, notifications });
		service.getTournamentReminders = jest.fn().mockResolvedValue([{
			id: "tournament-1",
			name: "Friday Open",
			starts_at: "2026-09-24T18:00:00.000Z",
			prize_pool: "250",
		}]);
		service.getRecipientEmails = jest.fn().mockResolvedValue({
			participantCount: 2,
			emails: ["one@example.com", "two@example.com"],
		});

		await service.dispatchTournamentReminders(minutes, now);

		expect(notifications.sendTournamentAlerts).toHaveBeenCalledWith(
			expect.objectContaining({ participantCount: 2, prizePool: "250" }),
			["one@example.com", "two@example.com"],
			minutes,
		);
		expect(updateEq).toHaveBeenCalledWith("id", "tournament-1");
	});
});
