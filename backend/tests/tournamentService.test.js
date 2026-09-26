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

// Mock dependencies
jest.mock("../models/tournamentModel");
jest.mock("../models/gameModel");
jest.mock("../services/escrowService");

describe("Tournament Service - Bracket Generation & Seeding Algorithm (Issue #223)", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	describe("seedPlayers", () => {
		it("should sort participants descending by Elo and assign 1-based seed numbers", () => {
			const participants = [
				{ wallet_address: "ADDR_3", elo: 1250 },
				{ wallet_address: "ADDR_1", elo: 1800 },
				{ wallet_address: "ADDR_4", elo: 1100 },
				{ wallet_address: "ADDR_2", elo: 1500 },
			];

			const seeded = tournamentService.seedPlayers(participants);

			expect(seeded).toHaveLength(4);
			expect(seeded[0].wallet_address).toBe("ADDR_1");
			expect(seeded[0].seed).toBe(1);
			expect(seeded[1].wallet_address).toBe("ADDR_2");
			expect(seeded[1].seed).toBe(2);
			expect(seeded[2].wallet_address).toBe("ADDR_3");
			expect(seeded[2].seed).toBe(3);
			expect(seeded[3].wallet_address).toBe("ADDR_4");
			expect(seeded[3].seed).toBe(4);
		});

		it("should default missing or invalid Elo to 1200", () => {
			const participants = [
				{ wallet_address: "ADDR_LOW", elo: 900 },
				{ wallet_address: "ADDR_DEFAULT_1" },
				{ wallet_address: "ADDR_DEFAULT_2", elo: "invalid" },
				{ wallet_address: "ADDR_HIGH", elo: 1600 },
			];

			const seeded = tournamentService.seedPlayers(participants);

			expect(seeded[0].wallet_address).toBe("ADDR_HIGH");
			expect(seeded[0].seed).toBe(1);

			// Defaults should be 1200
			expect(seeded[1].elo).toBe(1200);
			expect(seeded[2].elo).toBe(1200);

			expect(seeded[3].wallet_address).toBe("ADDR_LOW");
			expect(seeded[3].seed).toBe(4);
		});

		it("should normalize alternative address keys (walletAddress, address, player_address)", () => {
			const participants = [
				{ walletAddress: "W_ADDR", elo: 1400 },
				{ address: "P_ADDR", elo: 1700 },
				{ player_address: "PL_ADDR", elo: 1100 },
			];

			const seeded = tournamentService.seedPlayers(participants);

			expect(seeded[0].wallet_address).toBe("P_ADDR");
			expect(seeded[1].wallet_address).toBe("W_ADDR");
			expect(seeded[2].wallet_address).toBe("PL_ADDR");
		});

		it("should deterministically sort ties using wallet address", () => {
			const participants = [
				{ wallet_address: "ADDR_B", elo: 1500 },
				{ wallet_address: "ADDR_A", elo: 1500 },
			];

			const seeded = tournamentService.seedPlayers(participants);

			expect(seeded[0].wallet_address).toBe("ADDR_A");
			expect(seeded[1].wallet_address).toBe("ADDR_B");
		});

		it("should handle empty or non-array inputs gracefully", () => {
			expect(tournamentService.seedPlayers([])).toEqual([]);
			expect(tournamentService.seedPlayers(null)).toEqual([]);
		});
	});

	describe("generateCanonicalBracketSeedOrder", () => {
		it("should generate canonical sequence for 2 players", () => {
			const order = tournamentService.generateCanonicalBracketSeedOrder(2);
			expect(order).toEqual([1, 2]);
		});

		it("should generate canonical sequence for 4 players (#1 vs #4, #2 vs #3 at opposite poles)", () => {
			const order = tournamentService.generateCanonicalBracketSeedOrder(4);
			expect(order).toEqual([1, 4, 2, 3]);

			// Match 1: Seed 1 vs Seed 4
			// Match 2: Seed 2 vs Seed 3
			// Seed 1 is in top half, Seed 2 is in bottom half
			expect(order[0]).toBe(1);
			expect(order[1]).toBe(4);
			expect(order[2]).toBe(2);
			expect(order[3]).toBe(3);
		});

		it("should generate canonical sequence for 8 players", () => {
			const order = tournamentService.generateCanonicalBracketSeedOrder(8);
			expect(order).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);

			// Match 1: 1 vs 8
			// Match 2: 4 vs 5
			// Match 3: 2 vs 7
			// Match 4: 3 vs 6
			// Seeds 1 and 2 can only meet in the final (Match 1/2 meet, Match 3/4 meet)
			expect(order.slice(0, 2)).toEqual([1, 8]);
			expect(order.slice(2, 4)).toEqual([4, 5]);
			expect(order.slice(4, 6)).toEqual([2, 7]);
			expect(order.slice(6, 8)).toEqual([3, 6]);
		});

		it("should generate canonical sequence for 16 players", () => {
			const order = tournamentService.generateCanonicalBracketSeedOrder(16);
			expect(order).toEqual([1, 16, 8, 9, 4, 13, 5, 12, 2, 15, 7, 10, 3, 14, 6, 11]);

			// Check first round pairings
			expect(order.slice(0, 2)).toEqual([1, 16]); // Seed 1 vs Seed 16
			expect(order.slice(8, 10)).toEqual([2, 15]); // Seed 2 vs Seed 15 in opposite half
		});
	});

	describe("generateSingleEliminationBracket", () => {
		it("should throw an error when fewer than 2 participants are provided", async () => {
			await expect(
				tournamentService.generateSingleEliminationBracket("TOURN_1", [{ wallet_address: "ADDR_1" }]),
			).rejects.toThrow("requires at least 2 participants");
		});

		it("should generate a 4-player bracket correctly with 3 total matches", async () => {
			const participants = [
				{ wallet_address: "P1", elo: 1900 },
				{ wallet_address: "P2", elo: 1800 },
				{ wallet_address: "P3", elo: 1600 },
				{ wallet_address: "P4", elo: 1400 },
			];

			let inMemoryMatches = [];
			tournamentModel.createBracketMatches.mockImplementation(async (matches) => {
				inMemoryMatches = matches.map((m, idx) => ({ ...m, id: `match-${idx + 1}` }));
				return inMemoryMatches;
			});
			tournamentModel.getBracketMatches.mockImplementation(async () => inMemoryMatches);
			tournamentModel.updateTournamentStatus.mockResolvedValue({ id: "TOURN_4", status: "in_progress" });

			const result = await tournamentService.generateSingleEliminationBracket("TOURN_4", participants);

			expect(result).toHaveLength(3); // 2 in R1, 1 in R2 (Finals)
			expect(tournamentModel.createBracketMatches).toHaveBeenCalledTimes(1);

			const r1Matches = result.filter((m) => m.round === 1);
			expect(r1Matches).toHaveLength(2);

			// Match 1: Seed 1 (P1) vs Seed 4 (P4)
			expect(r1Matches[0].player_one).toBe("P1");
			expect(r1Matches[0].player_two).toBe("P4");
			expect(r1Matches[0].status).toBe("ready");

			// Match 2: Seed 2 (P2) vs Seed 3 (P3)
			expect(r1Matches[1].player_one).toBe("P2");
			expect(r1Matches[1].player_two).toBe("P3");
			expect(r1Matches[1].status).toBe("ready");

			// Final node: round 2, match 1
			const finalMatch = result.find((m) => m.round === 2);
			expect(finalMatch).toBeDefined();
			expect(finalMatch.player_one).toBeNull();
			expect(finalMatch.player_two).toBeNull();
			expect(finalMatch.status).toBe("pending");

			expect(tournamentModel.updateTournamentStatus).toHaveBeenCalledWith("TOURN_4", "in_progress");
		});

		it("should generate an 8-player bracket correctly with 7 total matches", async () => {
			const participants = Array.from({ length: 8 }, (_, i) => ({
				wallet_address: `PLAYER_${i + 1}`,
				elo: 2000 - i * 100, // Seeds 1 to 8 in order
			}));

			let inMemoryMatches = [];
			tournamentModel.createBracketMatches.mockImplementation(async (matches) => {
				inMemoryMatches = matches.map((m, idx) => ({ ...m, id: `match-${idx + 1}` }));
				return inMemoryMatches;
			});
			tournamentModel.getBracketMatches.mockImplementation(async () => inMemoryMatches);
			tournamentModel.updateTournamentStatus.mockResolvedValue({});

			const result = await tournamentService.generateSingleEliminationBracket("TOURN_8", participants);

			expect(result).toHaveLength(7); // 4 + 2 + 1 = 7

			const r1 = result.filter((m) => m.round === 1);
			expect(r1).toHaveLength(4);
			expect(r1[0].player_one).toBe("PLAYER_1"); // Seed 1
			expect(r1[0].player_two).toBe("PLAYER_8"); // Seed 8
			expect(r1[1].player_one).toBe("PLAYER_4"); // Seed 4
			expect(r1[1].player_two).toBe("PLAYER_5"); // Seed 5
			expect(r1[2].player_one).toBe("PLAYER_2"); // Seed 2
			expect(r1[2].player_two).toBe("PLAYER_7"); // Seed 7
			expect(r1[3].player_one).toBe("PLAYER_3"); // Seed 3
			expect(r1[3].player_two).toBe("PLAYER_6"); // Seed 6

			const r2 = result.filter((m) => m.round === 2);
			expect(r2).toHaveLength(2);

			const r3 = result.filter((m) => m.round === 3);
			expect(r3).toHaveLength(1);
		});

		it("should generate a 16-player bracket correctly with 15 total matches", async () => {
			const participants = Array.from({ length: 16 }, (_, i) => ({
				wallet_address: `PLAYER_${i + 1}`,
				elo: 2000 - i * 50,
			}));

			let inMemoryMatches = [];
			tournamentModel.createBracketMatches.mockImplementation(async (matches) => {
				inMemoryMatches = matches.map((m, idx) => ({ ...m, id: `match-${idx + 1}` }));
				return inMemoryMatches;
			});
			tournamentModel.getBracketMatches.mockImplementation(async () => inMemoryMatches);
			tournamentModel.updateTournamentStatus.mockResolvedValue({});

			const result = await tournamentService.generateSingleEliminationBracket("TOURN_16", participants);

			expect(result).toHaveLength(15); // 8 + 4 + 2 + 1 = 15
			expect(result.filter((m) => m.round === 1)).toHaveLength(8);
			expect(result.filter((m) => m.round === 2)).toHaveLength(4);
			expect(result.filter((m) => m.round === 3)).toHaveLength(2);
			expect(result.filter((m) => m.round === 4)).toHaveLength(1);
		});

		it("should support byes and auto-advance top seeds when count is not a power of 2 (e.g. 6 players in 8-bracket)", async () => {
			const participants = [
				{ wallet_address: "SEED_1", elo: 2000 },
				{ wallet_address: "SEED_2", elo: 1900 },
				{ wallet_address: "SEED_3", elo: 1800 },
				{ wallet_address: "SEED_4", elo: 1700 },
				{ wallet_address: "SEED_5", elo: 1600 },
				{ wallet_address: "SEED_6", elo: 1500 },
			];

			let inMemoryMatches = [];
			tournamentModel.createBracketMatches.mockImplementation(async (matches) => {
				inMemoryMatches = matches.map((m, idx) => ({ ...m, id: `match-${idx + 1}` }));
				return inMemoryMatches;
			});
			tournamentModel.getBracketMatches.mockImplementation(async () => inMemoryMatches);
			tournamentModel.updateTournamentStatus.mockResolvedValue({});
			tournamentModel.getMatchById.mockImplementation(async (id) => inMemoryMatches.find((m) => m.id === id));
			tournamentModel.getNextRoundMatch.mockImplementation(async (tId, mId) => {
				const cur = inMemoryMatches.find((m) => m.id === mId);
				const nextRound = cur.round + 1;
				const nextMatchNum = Math.ceil(cur.match_number / 2);
				return inMemoryMatches.find((m) => m.round === nextRound && m.match_number === nextMatchNum);
			});
			tournamentModel.assignPlayerToMatch.mockImplementation(async (id, addr, slot) => {
				const m = inMemoryMatches.find((item) => item.id === id);
				m[slot] = addr;
				return m;
			});
			tournamentModel.setMatchWinner.mockImplementation(async (id, w) => {
				const m = inMemoryMatches.find((item) => item.id === id);
				m.winner = w;
				m.status = "completed";
				return m;
			});

			const result = await tournamentService.generateSingleEliminationBracket("TOURN_6", participants);

			expect(result).toHaveLength(7);

			// Match 1: Seed 1 vs Seed 8 (bye) -> status 'bye', winner 'SEED_1'
			const match1 = result.find((m) => m.round === 1 && m.match_number === 1);
			expect(match1.player_one).toBe("SEED_1");
			expect(match1.player_two).toBeNull();
			expect(match1.status).toBe("bye");
			expect(match1.winner).toBe("SEED_1");

			// Match 3: Seed 2 vs Seed 7 (bye) -> status 'bye', winner 'SEED_2'
			const match3 = result.find((m) => m.round === 1 && m.match_number === 3);
			expect(match3.player_one).toBe("SEED_2");
			expect(match3.player_two).toBeNull();
			expect(match3.status).toBe("bye");
			expect(match3.winner).toBe("SEED_2");

			// Verify auto-advancement of byes into Round 2:
			// Match 1 feeds into R2 Match 1 slot player_one
			const r2Match1 = result.find((m) => m.round === 2 && m.match_number === 1);
			expect(r2Match1.player_one).toBe("SEED_1");

			// Match 3 feeds into R2 Match 2 slot player_one
			const r2Match2 = result.find((m) => m.round === 2 && m.match_number === 2);
			expect(r2Match2.player_one).toBe("SEED_2");
		});
	});
});
