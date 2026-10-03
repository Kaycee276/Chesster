const express = require("express");
const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

jest.mock("../models/tournamentModel", () => ({
	listTournaments: jest.fn(),
	getTournamentById: jest.fn(),
	getParticipants: jest.fn(),
	getBracketMatches: jest.fn(),
	countParticipants: jest.fn(),
	isParticipant: jest.fn(),
	addParticipant: jest.fn(),
}));

const tournamentModel = require("../models/tournamentModel");
const tournamentRoutes = require("../routes/tournamentRoutes");
const tournamentController = require("../controllers/tournamentController");

const TOURNAMENT_ID = "11111111-1111-4111-8111-111111111111";

function buildApp() {
	const app = express();
	app.use(express.json());
	app.use("/api", tournamentRoutes);
	// Mirror the production error handler contract for unexpected failures.
	app.use((err, req, res, _next) => {
		res.status(500).json({ success: false, error: err.message });
	});
	return app;
}

function signRegistration(keypair) {
	const message = tournamentController.registrationMessage(keypair.publicKey());
	return keypair.sign(Buffer.from(message, "utf8")).toString("base64");
}

describe("tournament REST API", () => {
	let app;

	beforeEach(() => {
		jest.clearAllMocks();
		app = buildApp();
	});

	describe("GET /api/tournaments", () => {
		test("returns a list of tournaments", async () => {
			const tournaments = [{ id: TOURNAMENT_ID, name: "Spring Open", status: "open" }];
			tournamentModel.listTournaments.mockResolvedValue(tournaments);

			const response = await request(app).get("/api/tournaments");

			expect(response.status).toBe(200);
			expect(response.body).toEqual({ success: true, count: 1, tournaments });
			expect(tournamentModel.listTournaments).toHaveBeenCalledWith({ status: undefined, limit: 50 });
		});

		test("forwards status and limit filters", async () => {
			tournamentModel.listTournaments.mockResolvedValue([]);

			const response = await request(app).get("/api/tournaments?status=open&limit=5");

			expect(response.status).toBe(200);
			expect(tournamentModel.listTournaments).toHaveBeenCalledWith({ status: "open", limit: 5 });
		});

		test("rejects an invalid status filter with 400", async () => {
			const response = await request(app).get("/api/tournaments?status=bogus");

			expect(response.status).toBe(400);
			expect(response.body.success).toBe(false);
			expect(tournamentModel.listTournaments).not.toHaveBeenCalled();
		});

		test("rejects an out-of-range limit with 400", async () => {
			const response = await request(app).get("/api/tournaments?limit=500");

			expect(response.status).toBe(400);
			expect(tournamentModel.listTournaments).not.toHaveBeenCalled();
		});
	});

	describe("GET /api/tournaments/:id", () => {
		test("returns tournament details with participant roster", async () => {
			tournamentModel.getTournamentById.mockResolvedValue({
				id: TOURNAMENT_ID,
				name: "Spring Open",
				status: "open",
				max_players: 8,
			});
			tournamentModel.getParticipants.mockResolvedValue([
				{ wallet_address: "GAAA", seed: 1 },
			]);

			const response = await request(app).get(`/api/tournaments/${TOURNAMENT_ID}`);

			expect(response.status).toBe(200);
			expect(response.body.success).toBe(true);
			expect(response.body.tournament.participantCount).toBe(1);
			expect(response.body.tournament.participants).toHaveLength(1);
		});

		test("returns 404 when the tournament does not exist", async () => {
			tournamentModel.getTournamentById.mockResolvedValue(null);

			const response = await request(app).get(`/api/tournaments/${TOURNAMENT_ID}`);

			expect(response.status).toBe(404);
			expect(response.body.success).toBe(false);
		});

		test("rejects a non-UUID id with 400", async () => {
			const response = await request(app).get("/api/tournaments/not-a-uuid");

			expect(response.status).toBe(400);
			expect(tournamentModel.getTournamentById).not.toHaveBeenCalled();
		});
	});

	describe("GET /api/tournaments/:id/bracket", () => {
		test("returns a hierarchical round-by-round tree", async () => {
			tournamentModel.getTournamentById.mockResolvedValue({ id: TOURNAMENT_ID, status: "in_progress" });
			tournamentModel.getBracketMatches.mockResolvedValue([
				{
					id: "m1",
					round: 1,
					match_number: 1,
					status: "completed",
					player_one: "GAAA",
					player_two: "GBBB",
					winner: "GAAA",
					game_code: "ABCD12",
				},
				{
					id: "m2",
					round: 2,
					match_number: 1,
					status: "pending",
					player_one: "GAAA",
					player_two: null,
					winner: null,
					game_code: null,
				},
			]);
			tournamentModel.getParticipants.mockResolvedValue([
				{ wallet_address: "GAAA", seed: 1, rating: 1500 },
				{ wallet_address: "GBBB", seed: 2, rating: 1400 },
			]);

			const response = await request(app).get(`/api/tournaments/${TOURNAMENT_ID}/bracket`);

			expect(response.status).toBe(200);
			const { bracket } = response.body;
			expect(bracket.totalRounds).toBe(2);
			expect(bracket.rounds).toHaveLength(2);
			expect(bracket.rounds[0].matches[0].playerOne).toEqual({
				walletAddress: "GAAA",
				username: null,
				rating: 1500,
				seed: 1,
			});
			expect(bracket.rounds[1].matches[0].playerTwo).toBeNull();
			expect(bracket.rounds[1].name).toBe("Final");
		});

		test("returns 404 when the tournament does not exist", async () => {
			tournamentModel.getTournamentById.mockResolvedValue(null);

			const response = await request(app).get(`/api/tournaments/${TOURNAMENT_ID}/bracket`);

			expect(response.status).toBe(404);
		});
	});

	describe("POST /api/tournaments/:id/register", () => {
		test("registers a player with a valid wallet signature", async () => {
			const keypair = Keypair.random();
			tournamentModel.getTournamentById.mockResolvedValue({
				id: TOURNAMENT_ID,
				status: "open",
				max_players: 8,
			});
			tournamentModel.isParticipant.mockResolvedValue(false);
			tournamentModel.countParticipants.mockResolvedValue(2);
			tournamentModel.addParticipant.mockResolvedValue({
				tournament_id: TOURNAMENT_ID,
				wallet_address: keypair.publicKey(),
				seed: 3,
			});

			const response = await request(app)
				.post(`/api/tournaments/${TOURNAMENT_ID}/register`)
				.send({ walletAddress: keypair.publicKey(), signature: signRegistration(keypair) });

			expect(response.status).toBe(201);
			expect(response.body.success).toBe(true);
			expect(response.body.participantCount).toBe(3);
			expect(tournamentModel.addParticipant).toHaveBeenCalledWith(
				TOURNAMENT_ID,
				keypair.publicKey(),
				3,
			);
		});

		test("rejects an invalid signature with 401", async () => {
			const keypair = Keypair.random();
			tournamentModel.getTournamentById.mockResolvedValue({
				id: TOURNAMENT_ID,
				status: "open",
				max_players: 8,
			});

			const response = await request(app)
				.post(`/api/tournaments/${TOURNAMENT_ID}/register`)
				.send({ walletAddress: keypair.publicKey(), signature: "bm90LWEtc2ln" });

			expect(response.status).toBe(401);
			expect(tournamentModel.addParticipant).not.toHaveBeenCalled();
		});

		test("rejects duplicate registration with 409", async () => {
			const keypair = Keypair.random();
			tournamentModel.getTournamentById.mockResolvedValue({
				id: TOURNAMENT_ID,
				status: "open",
				max_players: 8,
			});
			tournamentModel.isParticipant.mockResolvedValue(true);

			const response = await request(app)
				.post(`/api/tournaments/${TOURNAMENT_ID}/register`)
				.send({ walletAddress: keypair.publicKey(), signature: signRegistration(keypair) });

			expect(response.status).toBe(409);
			expect(tournamentModel.addParticipant).not.toHaveBeenCalled();
		});

		test("rejects registration after registration is closed with 409", async () => {
			const keypair = Keypair.random();
			tournamentModel.getTournamentById.mockResolvedValue({
				id: TOURNAMENT_ID,
				status: "in_progress",
				max_players: 8,
			});

			const response = await request(app)
				.post(`/api/tournaments/${TOURNAMENT_ID}/register`)
				.send({ walletAddress: keypair.publicKey(), signature: signRegistration(keypair) });

			expect(response.status).toBe(409);
			expect(tournamentModel.addParticipant).not.toHaveBeenCalled();
		});

		test("rejects registration when the tournament is full with 409", async () => {
			const keypair = Keypair.random();
			tournamentModel.getTournamentById.mockResolvedValue({
				id: TOURNAMENT_ID,
				status: "open",
				max_players: 2,
			});
			tournamentModel.isParticipant.mockResolvedValue(false);
			tournamentModel.countParticipants.mockResolvedValue(2);

			const response = await request(app)
				.post(`/api/tournaments/${TOURNAMENT_ID}/register`)
				.send({ walletAddress: keypair.publicKey(), signature: signRegistration(keypair) });

			expect(response.status).toBe(409);
			expect(tournamentModel.addParticipant).not.toHaveBeenCalled();
		});

		test("rejects a malformed wallet address with 400", async () => {
			const response = await request(app)
				.post(`/api/tournaments/${TOURNAMENT_ID}/register`)
				.send({ walletAddress: "not-a-wallet", signature: "abc" });

			expect(response.status).toBe(400);
			expect(tournamentModel.getTournamentById).not.toHaveBeenCalled();
		});

		test("rejects a missing signature with 400", async () => {
			const keypair = Keypair.random();

			const response = await request(app)
				.post(`/api/tournaments/${TOURNAMENT_ID}/register`)
				.send({ walletAddress: keypair.publicKey() });

			expect(response.status).toBe(400);
		});
	});
});
