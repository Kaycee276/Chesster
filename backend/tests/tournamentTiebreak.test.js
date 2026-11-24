const express = require("express");
const request = require("supertest");

jest.mock("@stellar/stellar-sdk", () => ({
	Keypair: { fromPublicKey: jest.fn() },
}));
jest.mock("../services/escrowService", () => ({
	completeTournament: jest.fn(),
}));
jest.mock("../models/gameModel", () => ({
	createGame: jest.fn(),
	joinGame: jest.fn(),
}));
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
const tournamentService = require("../services/tournamentService");

const TOURNAMENT_ID = "33333333-3333-4333-8333-333333333333";

function buildApp() {
	const app = express();
	app.use(express.json());
	app.use("/api", tournamentRoutes);
	app.use((err, req, res, _next) => {
		res.status(500).json({ success: false, error: err.message });
	});
	return app;
}

describe("FIDE Swiss Tiebreak Engine (Issue #711)", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	describe("Buchholz and Buchholz Cut 1 calculations", () => {
		const players = [
			{ wallet_address: "A", score: 3.0 },
			{ wallet_address: "B", score: 3.0 },
			{ wallet_address: "C", score: 2.0 },
			{ wallet_address: "D", score: 2.0 },
			{ wallet_address: "E", score: 1.0 },
			{ wallet_address: "F", score: 1.0 },
			{ wallet_address: "G", score: 0.0 },
		];

		const matches = [
			// A faced: C (2.0), D (2.0), G (0.0) -> Buchholz = 4.0, Cut 1 = 4.0 (drops 0.0)
			{ round: 1, player_one: "A", player_two: "C", winner: "A", status: "completed" },
			{ round: 2, player_one: "A", player_two: "D", winner: "A", status: "completed" },
			{ round: 3, player_one: "A", player_two: "G", winner: "A", status: "completed" },
			// B faced: E (1.0), F (1.0), C (2.0) -> Buchholz = 4.0, Cut 1 = 3.0 (drops 1.0)
			{ round: 1, player_one: "B", player_two: "E", winner: "B", status: "completed" },
			{ round: 2, player_one: "B", player_two: "F", winner: "B", status: "completed" },
			{ round: 3, player_one: "B", player_two: "C", winner: "B", status: "completed" },
			// Pending and bye matches must be ignored
			{ round: 4, player_one: "A", player_two: "B", status: "pending" },
			{ round: 4, player_one: "G", status: "bye", winner: "G" },
		];

		it("calculates full Buchholz and Buchholz Cut 1 accurately", () => {
			const buchholz = tournamentService.calculateBuchholz(players, matches);
			const cut1 = tournamentService.calculateBuchholzCut1(players, matches);

			expect(buchholz.get("A")).toBe(4.0);
			expect(buchholz.get("B")).toBe(4.0);

			// Cut 1 drops lowest opponent: A drops G (0.0) -> 4.0; B drops E/F (1.0) -> 3.0
			expect(cut1.get("A")).toBe(4.0);
			expect(cut1.get("B")).toBe(3.0);
		});

		it("returns 0 for Buchholz Cut 1 when a player has 0 or 1 completed opponents", () => {
			const soloPlayers = [
				{ wallet_address: "P1", score: 1.0 },
				{ wallet_address: "P2", score: 0.0 },
				{ wallet_address: "P3", score: 1.0 },
			];
			const singleRound = [
				{ round: 1, player_one: "P1", player_two: "P2", winner: "P1", status: "completed" },
				{ round: 1, player_one: "P3", status: "bye", winner: "P3" },
			];

			const cut1 = tournamentService.calculateBuchholzCut1(soloPlayers, singleRound);
			expect(cut1.get("P1")).toBe(0);
			expect(cut1.get("P2")).toBe(0);
			expect(cut1.get("P3")).toBe(0);
		});
	});

	describe("Sonneborn-Berger calculation", () => {
		it("weights defeated opponents at 1.0 and drawn opponents at 0.5 across match schemas", () => {
			const players = [
				{ walletAddress: "W1", points: 2.5 },
				{ walletAddress: "W2", points: 2.0 },
				{ walletAddress: "W3", points: 1.0 },
				{ walletAddress: "W4", points: 0.5 },
			];
			const matches = [
				{ round: 1, white: "W1", black: "W3", winner: "W1" },
				{ round: 2, white: "W1", black: "W2", isDraw: true },
				{ round: 3, white: "W1", black: "W4", winner: "W1" },
				{ round: 1, white: "W2", black: "W4", winner: "W2" },
				{ round: 2, white: "W3", black: "W4", result: "draw" },
			];

			const sb = tournamentService.calculateSonnebornBerger(players, matches);
			// W1 beat W3 (1.0), beat W4 (0.5), drew W2 (2.0 * 0.5 = 1.0) -> 2.5
			expect(sb.get("W1")).toBe(2.5);
			// W2 beat W4 (0.5), drew W1 (2.5 * 0.5 = 1.25) -> 1.75
			expect(sb.get("W2")).toBe(1.75);
			// W3 lost to W1 (0), drew W4 (0.5 * 0.5 = 0.25) -> 0.25
			expect(sb.get("W3")).toBe(0.25);
			// W4 lost to W1, W2; drew W3 (1.0 * 0.5 = 0.5) -> 0.5
			expect(sb.get("W4")).toBe(0.5);
		});
	});

	describe("Direct Encounter comparison", () => {
		const matches = [
			{ round: 1, player_one: "P1", player_two: "P2", winner: "P1", status: "completed" },
			{ round: 2, player_one: "P2", player_two: "P3", is_draw: true, status: "completed" },
			{ round: 3, player_one: "P1", player_two: "P3", status: "pending" },
		];

		it("returns positive when playerA beat playerB and negative when playerB beat playerA", () => {
			expect(tournamentService.compareDirectEncounter("P1", "P2", matches)).toBe(1);
			expect(tournamentService.compareDirectEncounter("P2", "P1", matches)).toBe(-1);
		});

		it("returns 0 for draws, unmet players, or identical player addresses", () => {
			expect(tournamentService.compareDirectEncounter("P2", "P3", matches)).toBe(0);
			expect(tournamentService.compareDirectEncounter("P1", "P3", matches)).toBe(0);
			expect(tournamentService.compareDirectEncounter("P1", "P1", matches)).toBe(0);
			expect(tournamentService.compareDirectEncounter("", "P2", matches)).toBe(0);
		});
	});

	describe("FIDE priority chain sorting (Points -> Buchholz Cut 1 -> SB -> Direct Encounter -> Cumulative Wins)", () => {
		it("breaks ties by Buchholz Cut 1 before Sonneborn-Berger", () => {
			const players = [
				{ wallet_address: "P_LOW_CUT1", score: 2.0 },
				{ wallet_address: "P_HIGH_CUT1", score: 2.0 },
				{ wallet_address: "OPP_STRONG", score: 3.0 },
				{ wallet_address: "OPP_MID", score: 2.0 },
				{ wallet_address: "OPP_WEAK", score: 0.0 },
			];
			const matches = [
				// P_HIGH_CUT1: beat OPP_MID (2.0), beat OPP_WEAK (0.0), lost to OPP_STRONG (3.0)
				// Opp scores: [0, 2, 3] -> Cut 1 = 5.0, SB = 2.0
				{ round: 1, player_one: "P_HIGH_CUT1", player_two: "OPP_MID", winner: "P_HIGH_CUT1", status: "completed" },
				{ round: 2, player_one: "P_HIGH_CUT1", player_two: "OPP_WEAK", winner: "P_HIGH_CUT1", status: "completed" },
				{ round: 3, player_one: "P_HIGH_CUT1", player_two: "OPP_STRONG", winner: "OPP_STRONG", status: "completed" },

				// P_LOW_CUT1: beat OPP_STRONG (3.0), beat OPP_WEAK (0.0), lost to OPP_WEAK (0.0)
				// Opp scores: [0, 0, 3] -> Cut 1 = 3.0, SB = 3.0 (higher SB, lower Cut 1)
				{ round: 1, player_one: "P_LOW_CUT1", player_two: "OPP_STRONG", winner: "P_LOW_CUT1", status: "completed" },
				{ round: 2, player_one: "P_LOW_CUT1", player_two: "OPP_WEAK", winner: "P_LOW_CUT1", status: "completed" },
				{ round: 3, player_one: "P_LOW_CUT1", player_two: "OPP_WEAK", winner: "OPP_WEAK", status: "completed" },
			];

			const standings = tournamentService.rankTournamentStandings(players, matches);
			const idxHigh = standings.findIndex((p) => p.wallet_address === "P_HIGH_CUT1");
			const idxLow = standings.findIndex((p) => p.wallet_address === "P_LOW_CUT1");

			expect(standings[idxHigh].buchholzCut1).toBe(5.0);
			expect(standings[idxLow].buchholzCut1).toBe(3.0);
			expect(idxHigh).toBeLessThan(idxLow);
		});

		it("breaks ties by Sonneborn-Berger when Points and Buchholz Cut 1 are equal", () => {
			const players = [
				{ wallet_address: "A", score: 1.0 },
				{ wallet_address: "B", score: 1.0 },
				{ wallet_address: "STRONG", score: 2.0 },
				{ wallet_address: "WEAK", score: 0.0 },
			];
			const matches = [
				// A beat STRONG (2.0), lost to WEAK (0.0) -> Cut 1 = 2.0, SB = 2.0
				{ round: 1, player_one: "A", player_two: "STRONG", winner: "A", status: "completed" },
				{ round: 2, player_one: "A", player_two: "WEAK", winner: "WEAK", status: "completed" },
				// B lost to STRONG (2.0), beat WEAK (0.0) -> Cut 1 = 2.0, SB = 0.0
				{ round: 1, player_one: "B", player_two: "STRONG", winner: "STRONG", status: "completed" },
				{ round: 2, player_one: "B", player_two: "WEAK", winner: "B", status: "completed" },
			];

			const standings = tournamentService.rankTournamentStandings(players, matches);
			const idxA = standings.findIndex((p) => p.wallet_address === "A");
			const idxB = standings.findIndex((p) => p.wallet_address === "B");

			expect(standings[idxA].buchholzCut1).toBe(standings[idxB].buchholzCut1);
			expect(standings[idxA].sonnebornBerger).toBe(2.0);
			expect(standings[idxB].sonnebornBerger).toBe(0.0);
			expect(idxA).toBeLessThan(idxB);
		});

		it("breaks ties by Direct Encounter when Points, Buchholz Cut 1, and Sonneborn-Berger are equal", () => {
			// A and B both have 1.0 point, played each other (A beat B),
			// and each played C (1.0) with opposite outcomes so Cut 1 and SB are identical.
			const players = [
				{ wallet_address: "A", score: 1.0 },
				{ wallet_address: "B", score: 1.0 },
				{ wallet_address: "C", score: 1.0 },
			];
			const matches = [
				{ round: 1, player_one: "A", player_two: "B", winner: "A", status: "completed" },
				{ round: 2, player_one: "B", player_two: "C", winner: "B", status: "completed" },
				{ round: 3, player_one: "C", player_two: "A", winner: "C", status: "completed" },
			];

			// Every player has 1.0 pt, Cut 1 = 1.0, SB = 1.0.
			// Direct encounter between A and B favors A.
			expect(tournamentService.compareDirectEncounter("A", "B", matches)).toBe(1);

			// Two-player direct encounter tiebreak with identical external opponents:
			const twoTiedPlayers = [
				{ wallet_address: "P_WINNER", score: 1.0 },
				{ wallet_address: "P_LOSER", score: 1.0 },
				{ wallet_address: "EXT1", score: 1.0 },
				{ wallet_address: "EXT2", score: 1.0 },
			];
			const directMatches = [
				// P_WINNER beat P_LOSER (1.0) and lost to EXT1 (1.0) -> Cut 1 = 1.0, SB = 1.0
				{ round: 1, player_one: "P_WINNER", player_two: "P_LOSER", winner: "P_WINNER", status: "completed" },
				{ round: 2, player_one: "P_WINNER", player_two: "EXT1", winner: "EXT1", status: "completed" },
				// P_LOSER lost to P_WINNER (1.0) and beat EXT2 (1.0) -> Cut 1 = 1.0, SB = 1.0
				{ round: 2, player_one: "P_LOSER", player_two: "EXT2", winner: "P_LOSER", status: "completed" },
			];

			const standings = tournamentService.rankTournamentStandings(twoTiedPlayers, directMatches);
			const idxWinner = standings.findIndex((p) => p.wallet_address === "P_WINNER");
			const idxLoser = standings.findIndex((p) => p.wallet_address === "P_LOSER");

			expect(standings[idxWinner].buchholzCut1).toBe(1.0);
			expect(standings[idxLoser].buchholzCut1).toBe(1.0);
			expect(standings[idxWinner].sonnebornBerger).toBe(1.0);
			expect(standings[idxLoser].sonnebornBerger).toBe(1.0);
			expect(idxWinner).toBeLessThan(idxLoser);
		});

		it("breaks ties by Cumulative Wins when Points, Buchholz Cut 1, SB, and Direct Encounter are equal", () => {
			// P_WINS: 1 win + 1 loss = 1.0 pt (opponents: 1.0, 1.0) -> Cut 1 = 1.0, SB = 1.0, wins = 1
			// P_DRAWS: 2 draws = 1.0 pt (opponents: 1.0, 1.0) -> Cut 1 = 1.0, SB = 1.0, wins = 0
			const players = [
				{ wallet_address: "P_DRAWS", score: 1.0 },
				{ wallet_address: "P_WINS", score: 1.0 },
				{ wallet_address: "O1", score: 1.0 },
				{ wallet_address: "O2", score: 1.0 },
			];
			const matches = [
				{ round: 1, player_one: "P_WINS", player_two: "O1", winner: "P_WINS", status: "completed" },
				{ round: 2, player_one: "P_WINS", player_two: "O2", winner: "O2", status: "completed" },
				{ round: 1, player_one: "P_DRAWS", player_two: "O1", is_draw: true, status: "completed" },
				{ round: 2, player_one: "P_DRAWS", player_two: "O2", is_draw: true, status: "completed" },
			];

			const standings = tournamentService.rankTournamentStandings(players, matches);
			const idxWins = standings.findIndex((p) => p.wallet_address === "P_WINS");
			const idxDraws = standings.findIndex((p) => p.wallet_address === "P_DRAWS");

			expect(standings[idxWins].cumulativeWins).toBe(1);
			expect(standings[idxDraws].cumulativeWins).toBe(0);
			expect(standings[idxWins].buchholzCut1).toBe(standings[idxDraws].buchholzCut1);
			expect(standings[idxWins].sonnebornBerger).toBe(standings[idxDraws].sonnebornBerger);
			expect(idxWins).toBeLessThan(idxDraws);
		});

		it("derives scores and win/draw/loss records automatically when omitted from players", () => {
			const players = [
				{ wallet_address: "G1" },
				{ wallet_address: "G2" },
				{ wallet_address: "G3" },
			];
			const matches = [
				{ round: 1, player_one: "G1", player_two: "G2", winner: "G1", status: "completed" },
				{ round: 1, player_one: "G3", status: "bye", winner: "G3" },
				{ round: 2, player_one: "G1", player_two: "G3", is_draw: true, status: "completed" },
			];

			const standings = tournamentService.rankTournamentStandings(players, matches);
			expect(standings[0].wallet_address).toBe("G1");
			expect(standings[0].points).toBe(1.5);
			expect(standings[0].wins).toBe(1);
			expect(standings[0].draws).toBe(1);
			expect(standings[1].wallet_address).toBe("G3");
			expect(standings[1].points).toBe(1.5);
			expect(standings[2].wallet_address).toBe("G2");
			expect(standings[2].points).toBe(0);
			expect(standings[2].losses).toBe(1);
		});
	});

	describe("GET /api/tournaments/:id/standings API endpoint", () => {
		it("returns FIDE-ranked standings with tiebreak coefficients", async () => {
			const app = buildApp();
			tournamentModel.getTournamentById.mockResolvedValue({
				id: TOURNAMENT_ID,
				name: "FIDE Swiss Open",
				status: "completed",
			});
			tournamentModel.getParticipants.mockResolvedValue([
				{ wallet_address: "GPLAYER_B", elo: 1500 },
				{ wallet_address: "GPLAYER_A", elo: 1500 },
				{ wallet_address: "GPLAYER_C", elo: 1400 },
				{ wallet_address: "GPLAYER_D", elo: 1300 },
			]);
			tournamentModel.getBracketMatches.mockResolvedValue([
				{ round: 1, player_one: "GPLAYER_A", player_two: "GPLAYER_C", winner: "GPLAYER_A", status: "completed" },
				{ round: 1, player_one: "GPLAYER_B", player_two: "GPLAYER_D", winner: "GPLAYER_B", status: "completed" },
				{ round: 2, player_one: "GPLAYER_A", player_two: "GPLAYER_B", is_draw: true, status: "completed" },
				{ round: 2, player_one: "GPLAYER_C", player_two: "GPLAYER_D", winner: "GPLAYER_C", status: "completed" },
			]);

			const res = await request(app).get(`/api/tournaments/${TOURNAMENT_ID}/standings`);

			expect(res.status).toBe(200);
			expect(res.body.success).toBe(true);
			expect(res.body.standings).toHaveLength(4);
			expect(res.body.standings[0]).toMatchObject({
				rank: 1,
				wallet_address: "GPLAYER_A",
				points: 1.5,
				buchholz: 2.5,
				buchholzCut1: 1.5,
				sonnebornBerger: 1.75,
				cumulativeWins: 1,
			});
			expect(res.body.standings[1]).toMatchObject({
				rank: 2,
				wallet_address: "GPLAYER_B",
				points: 1.5,
				buchholz: 1.5,
				buchholzCut1: 1.5,
				sonnebornBerger: 0.75,
				cumulativeWins: 1,
			});
		});

		it("returns 404 when the tournament does not exist", async () => {
			const app = buildApp();
			tournamentModel.getTournamentById.mockResolvedValue(null);

			const res = await request(app).get(`/api/tournaments/${TOURNAMENT_ID}/standings`);

			expect(res.status).toBe(404);
			expect(res.body.success).toBe(false);
		});
	});
});
