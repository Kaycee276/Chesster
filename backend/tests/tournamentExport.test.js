const express = require("express");
const request = require("supertest");

jest.mock("../models/tournamentModel", () => ({
	getTournament: jest.fn(),
	getTournamentById: jest.fn(),
	getParticipants: jest.fn(),
	getBracketMatches: jest.fn(),
}));

const tournamentModel = require("../models/tournamentModel");
const tournamentRoutes = require("../routes/tournamentRoutes");
const tournamentService = require("../services/tournamentService");

const TOURNAMENT_ID = "22222222-2222-4222-8222-222222222222";

function buildApp() {
	const app = express();
	app.use(express.json());
	app.use("/api", tournamentRoutes);
	app.use((err, req, res, _next) => {
		res.status(500).json({ success: false, error: err.message });
	});
	return app;
}

describe("GET /api/tournaments/:id/export/csv (Issue #535)", () => {
	let app;

	beforeEach(() => {
		jest.clearAllMocks();
		app = buildApp();
	});

	it("exports a valid RFC 4180 CSV document with headers and participants", async () => {
		tournamentModel.getTournamentById.mockResolvedValue({
			id: TOURNAMENT_ID,
			name: "Grand Prix",
			winner_address: "GCHAMP11111111111111111111111111111111111111111111111111",
			prize_pool: 500,
		});

		tournamentModel.getParticipants.mockResolvedValue([
			{
				wallet_address: "GCHAMP11111111111111111111111111111111111111111111111111",
				wins: 3,
				losses: 0,
				draws: 0,
				points: 3,
				prize_xlm: 500,
			},
			{
				wallet_address: "GRUNNER22222222222222222222222222222222222222222222222222",
				wins: 2,
				losses: 1,
				draws: 0,
				points: 2,
				prize_xlm: 0,
			},
			{
				wallet_address: "GTHIRD,SPECIAL\"33333333333333333333333333333333333333333333",
				wins: 1,
				losses: 1,
				draws: 1,
				points: 1.5,
				prize_xlm: 0,
			},
		]);

		tournamentModel.getBracketMatches.mockResolvedValue([]);

		const res = await request(app).get(`/api/tournaments/${TOURNAMENT_ID}/export/csv`);

		expect(res.status).toBe(200);
		expect(res.headers["content-type"]).toMatch(/text\/csv/);
		expect(res.headers["content-disposition"]).toBe(
			`attachment; filename="tournament-${TOURNAMENT_ID}-report.csv"`
		);

		const lines = res.text.split("\n");
		expect(lines[0]).toBe("Rank,Wallet,Wins,Losses,Draws,Points,PrizeXLM");

		// Header + 3 participants = 4 lines
		expect(lines).toHaveLength(4);

		// Rank 1
		expect(lines[1]).toBe("1,GCHAMP11111111111111111111111111111111111111111111111111,3,0,0,3,500");
		// Rank 2
		expect(lines[2]).toBe("2,GRUNNER22222222222222222222222222222222222222222222222222,2,1,0,2,0");
		// Rank 3 with quotes and commas properly escaped per RFC 4180
		expect(lines[3]).toBe('3,"GTHIRD,SPECIAL""33333333333333333333333333333333333333333333",1,1,1,1.5,0');
	});

	it("returns 404 if tournament does not exist", async () => {
		tournamentModel.getTournamentById.mockResolvedValue(null);

		const res = await request(app).get(`/api/tournaments/${TOURNAMENT_ID}/export/csv`);
		expect(res.status).toBe(404);
		expect(res.body.success).toBe(false);
	});

	it("computes win/loss/draw stats from bracket matches when not explicitly on participant", async () => {
		tournamentModel.getTournamentById.mockResolvedValue({
			id: TOURNAMENT_ID,
			name: "Blitz Open",
			prize_pool: 100,
			winner_address: "GW1",
		});

		tournamentModel.getParticipants.mockResolvedValue([
			{ wallet_address: "GW1" },
			{ wallet_address: "GW2" },
		]);

		tournamentModel.getBracketMatches.mockResolvedValue([
			{
				status: "completed",
				player_one: "GW1",
				player_two: "GW2",
				winner: "GW1",
			},
		]);

		const res = await request(app).get(`/api/tournaments/${TOURNAMENT_ID}/export/csv`);
		expect(res.status).toBe(200);

		const lines = res.text.split("\n");
		expect(lines[0]).toBe("Rank,Wallet,Wins,Losses,Draws,Points,PrizeXLM");
		expect(lines[1]).toBe("1,GW1,1,0,0,1,100");
		expect(lines[2]).toBe("2,GW2,0,1,0,0,0");
	});
});
