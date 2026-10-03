// Keep tests independent of the SDK's ESM-only transitive hash module
jest.mock("@stellar/stellar-sdk", () => ({
	Networks: { TESTNET: "Test SDF Network ; September 2015" },
	rpc: { Server: jest.fn(() => ({ getLatestLedger: jest.fn().mockResolvedValue({ sequence: 1 }) })) },
	Keypair: { fromSecret: jest.fn() },
	Contract: jest.fn(),
	xdr: { ScVal: { scvVoid: jest.fn() } },
	nativeToScVal: jest.fn(),
	scValToNative: jest.fn(),
}));

const tournamentService = require("../services/tournamentService");
const tournamentModel = require("../models/tournamentModel");
const gameModel = require("../models/gameModel");
const escrowService = require("../services/escrowService");
const gameController = require("../controllers/gameController");

jest.mock("../models/tournamentModel");
jest.mock("../models/gameModel");
jest.mock("../services/escrowService");

describe("Tournament Round Advancement Engine & Match Instantiation (Issue #224)", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	describe("advanceMatchWinner", () => {
		it("should advance match winner to the next round bracket match slot", async () => {
			const completedMatch = {
				id: "m-r1-m1",
				tournament_id: "TOURN_1",
				round: 1,
				match_number: 1,
				player_one: "ADDR_ALICE",
				player_two: "ADDR_BOB",
				winner: null,
				status: "ready",
			};

			const nextRoundMatch = {
				id: "m-r2-m1",
				tournament_id: "TOURN_1",
				round: 2,
				match_number: 1,
				player_one: null,
				player_two: null,
				status: "pending",
			};

			tournamentModel.getMatchById.mockResolvedValue(completedMatch);
			tournamentModel.setMatchWinner.mockResolvedValue({
				...completedMatch,
				winner: "ADDR_ALICE",
				status: "completed",
			});
			tournamentModel.getNextRoundMatch.mockResolvedValue(nextRoundMatch);
			tournamentModel.assignPlayerToMatch.mockResolvedValue({
				...nextRoundMatch,
				player_one: "ADDR_ALICE",
				status: "pending",
			});

			const result = await tournamentService.advanceMatchWinner("TOURN_1", "m-r1-m1", "ADDR_ALICE");

			expect(tournamentModel.setMatchWinner).toHaveBeenCalledWith("m-r1-m1", "ADDR_ALICE");
			expect(tournamentModel.getNextRoundMatch).toHaveBeenCalledWith("TOURN_1", "m-r1-m1");
			// Since match_number 1 is odd, it assigns to player_one
			expect(tournamentModel.assignPlayerToMatch).toHaveBeenCalledWith("m-r2-m1", "ADDR_ALICE", "player_one");
			expect(result.winner).toBe("ADDR_ALICE");
			expect(result.isChampionship).toBe(false);
			expect(gameModel.createGame).not.toHaveBeenCalled(); // Only one player set so far
		});

		it("should automatically instantiate a game room when both players in next round match are assigned", async () => {
			const completedMatch2 = {
				id: "m-r1-m2",
				tournament_id: "TOURN_1",
				round: 1,
				match_number: 2,
				player_one: "ADDR_CHARLIE",
				player_two: "ADDR_DAVE",
				winner: null,
				status: "ready",
			};

			const nextRoundMatchWithP1 = {
				id: "m-r2-m1",
				tournament_id: "TOURN_1",
				round: 2,
				match_number: 1,
				player_one: "ADDR_ALICE", // Alice already arrived from M1
				player_two: null,
				status: "pending",
			};

			tournamentModel.getMatchById.mockResolvedValue(completedMatch2);
			tournamentModel.setMatchWinner.mockResolvedValue({
				...completedMatch2,
				winner: "ADDR_CHARLIE",
				status: "completed",
			});
			tournamentModel.getNextRoundMatch.mockResolvedValue(nextRoundMatchWithP1);

			// After assigning Charlie as player_two, both players are present!
			const bothPlayersReady = {
				...nextRoundMatchWithP1,
				player_two: "ADDR_CHARLIE",
				status: "ready",
			};
			tournamentModel.assignPlayerToMatch.mockResolvedValue(bothPlayersReady);

			// Mock gameModel creation
			gameModel.createGame.mockResolvedValue({
				id: "game-uuid-1",
				game_code: "GAME999",
				status: "waiting",
			});
			gameModel.joinGame.mockResolvedValue({
				game_code: "GAME999",
				status: "active",
			});
			tournamentModel.linkGameToMatch.mockResolvedValue({
				...bothPlayersReady,
				game_code: "GAME999",
				status: "in_progress",
			});

			const result = await tournamentService.advanceMatchWinner("TOURN_1", "m-r1-m2", "ADDR_CHARLIE");

			expect(tournamentModel.assignPlayerToMatch).toHaveBeenCalledWith("m-r2-m1", "ADDR_CHARLIE", "player_two");
			expect(gameModel.createGame).toHaveBeenCalledWith("chess", null, "ADDR_ALICE", 600);
			expect(gameModel.joinGame).toHaveBeenCalledWith("GAME999", "black", "ADDR_CHARLIE");
			expect(tournamentModel.linkGameToMatch).toHaveBeenCalledWith("m-r2-m1", "GAME999");
			expect(result.gameCode).toBe("GAME999");
		});

		it("should conclude tournament and trigger on-chain payout when Championship match finishes", async () => {
			const finalMatch = {
				id: "m-finals",
				tournament_id: "TOURN_CHAMP",
				round: 2,
				match_number: 1,
				player_one: "ADDR_ALICE",
				player_two: "ADDR_CHARLIE",
				winner: null,
				status: "in_progress",
			};

			tournamentModel.getMatchById.mockResolvedValue(finalMatch);
			tournamentModel.setMatchWinner.mockResolvedValue({
				...finalMatch,
				winner: "ADDR_ALICE",
				status: "completed",
			});
			// In finals, there is no next round match
			tournamentModel.getNextRoundMatch.mockResolvedValue(null);
			tournamentModel.updateTournamentStatus.mockResolvedValue({
				id: "TOURN_CHAMP",
				status: "completed",
			});
			escrowService.completeTournament.mockResolvedValue({ hash: "0xCHAMPION_TX_HASH" });

			const result = await tournamentService.advanceMatchWinner("TOURN_CHAMP", "m-finals", "ADDR_ALICE");

			expect(result.isChampionship).toBe(true);
			expect(result.winner).toBe("ADDR_ALICE");
			expect(tournamentModel.updateTournamentStatus).toHaveBeenCalledWith("TOURN_CHAMP", "completed");
			expect(escrowService.completeTournament).toHaveBeenCalledWith("TOURN_CHAMP", ["ADDR_ALICE"], [10000]);
		});
	});

	describe("checkRoundCompletion", () => {
		it("should return false when matches in the round are still pending or ready", async () => {
			tournamentModel.getBracketMatches.mockResolvedValue([
				{ round: 1, match_number: 1, status: "completed" },
				{ round: 1, match_number: 2, status: "ready" },
				{ round: 2, match_number: 1, status: "pending" },
			]);

			const isR1Done = await tournamentService.checkRoundCompletion("TOURN_1", 1);
			expect(isR1Done).toBe(false);
		});

		it("should return true when all matches in the round are completed or bye", async () => {
			tournamentModel.getBracketMatches.mockResolvedValue([
				{ round: 1, match_number: 1, status: "completed" },
				{ round: 1, match_number: 2, status: "bye" },
				{ round: 2, match_number: 1, status: "pending" },
			]);

			const isR1Done = await tournamentService.checkRoundCompletion("TOURN_1", 1);
			expect(isR1Done).toBe(true);
		});

		it("should return false when no matches exist for the round", async () => {
			tournamentModel.getBracketMatches.mockResolvedValue([
				{ round: 1, match_number: 1, status: "completed" },
			]);

			const isR99Done = await tournamentService.checkRoundCompletion("TOURN_1", 99);
			expect(isR99Done).toBe(false);
		});
	});

	describe("gameController.endGame hook", () => {
		it("should invoke tournament advancement when a game linked to a tournament match concludes", async () => {
			const req = {
				params: { gameCode: "TOURN_GAME_77" },
				body: { winner: "white", endReason: "checkmate" },
				app: { get: jest.fn().mockReturnValue({ to: jest.fn().mockReturnValue({ emit: jest.fn() }) }) },
			};
			const res = {
				status: jest.fn().mockReturnThis(),
				json: jest.fn(),
			};

			gameModel.getGame.mockResolvedValue({
				game_code: "TOURN_GAME_77",
				player_white_address: "ADDR_WHITE",
				player_black_address: "ADDR_BLACK",
				status: "active",
			});

			tournamentModel.getMatchByGameCode.mockResolvedValue({
				id: "bracket-m-42",
				tournament_id: "TOURN_100",
			});

			const spyAdvance = jest.spyOn(tournamentService, "advanceRound").mockResolvedValue({
				completedMatchId: "bracket-m-42",
				winner: "ADDR_WHITE",
				isChampionship: false,
			});

			await gameController.endGame(req, res);

			expect(tournamentModel.getMatchByGameCode).toHaveBeenCalledWith("TOURN_GAME_77");
			expect(spyAdvance).toHaveBeenCalledWith("TOURN_100", "bracket-m-42", "ADDR_WHITE");
			expect(res.json).toHaveBeenCalledWith(
				expect.objectContaining({
					success: true,
					data: expect.objectContaining({
						winner: "white",
						winnerAddress: "ADDR_WHITE",
					}),
				}),
			);
		});
	});
});
