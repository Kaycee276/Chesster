jest.mock("@stellar/stellar-sdk", () => ({
  Networks: { TESTNET: "Test SDF Network ; September 2015" },
  rpc: { Server: jest.fn() },
  Keypair: { fromSecret: jest.fn() },
  Contract: jest.fn(),
  xdr: { ScVal: { scvVoid: jest.fn() } },
  nativeToScVal: jest.fn(),
  scValToNative: jest.fn(),
}));

jest.mock("../models/tournamentModel");
jest.mock("../models/gameModel");
jest.mock("../services/escrowService");

const tournamentService = require("../services/tournamentService");
const tournamentModel = require("../models/tournamentModel");
const gameModel = require("../models/gameModel");
const escrowService = require("../services/escrowService");

describe("Tournament Bracket Full Lifecycle", () => {
  it("seeds eight players, advances every round, and settles the champion", async () => {
    const players = Array.from({ length: 8 }, (_, index) => ({
      wallet_address: `PLAYER_${index + 1}`,
      elo: 2000 - index * 100,
    }));
    const matches = [];
    let tournamentStatus = "open";

    tournamentModel.createBracketMatches.mockImplementation(async (payload) => {
      matches.push(...payload.map((match, index) => ({ ...match, id: `MATCH_${index + 1}` })));
      return matches;
    });
    tournamentModel.getBracketMatches.mockImplementation(async () => matches);
    tournamentModel.updateTournamentStatus.mockImplementation(async (_id, status) => {
      tournamentStatus = status;
      return { id: "TOURNAMENT_1", status };
    });
    tournamentModel.getMatchById.mockImplementation(async (id) =>
      matches.find((match) => match.id === id)
    );
    tournamentModel.setMatchWinner.mockImplementation(async (id, winner) => {
      const match = matches.find((candidate) => candidate.id === id);
      match.winner = winner;
      match.status = "completed";
      return match;
    });
    tournamentModel.getNextRoundMatch.mockImplementation(async (_id, matchId) => {
      const current = matches.find((match) => match.id === matchId);
      return (
        matches.find(
          (match) =>
            match.round === current.round + 1 &&
            match.match_number === Math.ceil(current.match_number / 2)
        ) || null
      );
    });
    tournamentModel.assignPlayerToMatch.mockImplementation(async (id, address, slot) => {
      const match = matches.find((candidate) => candidate.id === id);
      match[slot] = address;
      if (match.player_one && match.player_two) match.status = "ready";
      return match;
    });
    gameModel.createGame.mockImplementation(async () => ({
      game_code: `GAME_${gameModel.createGame.mock.calls.length}`,
    }));
    gameModel.joinGame.mockResolvedValue({});
    tournamentModel.linkGameToMatch.mockResolvedValue({});
    escrowService.completeTournament.mockResolvedValue("PAYOUT_TX");

    await tournamentService.generateSingleEliminationBracket("TOURNAMENT_1", players);
    expect(matches).toHaveLength(7);
    const firstRound = matches.filter((match) => match.round === 1);
    expect(firstRound).toHaveLength(4);
    expect(firstRound.map((match) => [match.player_one, match.player_two])).toEqual([
      ["PLAYER_1", "PLAYER_8"],
      ["PLAYER_4", "PLAYER_5"],
      ["PLAYER_2", "PLAYER_7"],
      ["PLAYER_3", "PLAYER_6"],
    ]);

    const winnersByRound = [
      ["PLAYER_1", "PLAYER_2", "PLAYER_3", "PLAYER_4"],
      ["PLAYER_1", "PLAYER_2"],
      ["PLAYER_1"],
    ];

    for (const [roundIndex, winners] of winnersByRound.entries()) {
      const round = roundIndex + 1;
      const roundMatches = matches.filter((match) => match.round === round);
      for (let index = 0; index < winners.length; index += 1) {
        await tournamentService.advanceMatchWinner(
          "TOURNAMENT_1",
          roundMatches[index].id,
          winners[index]
        );
      }
      if (round === 1) {
        expect(
          matches
            .filter((match) => match.round === 2)
            .map((match) => [match.player_one, match.player_two])
        ).toEqual([
          ["PLAYER_1", "PLAYER_2"],
          ["PLAYER_3", "PLAYER_4"],
        ]);
      }
      if (round === 2) {
        expect(matches.find((match) => match.round === 3)).toMatchObject({
          player_one: "PLAYER_1",
          player_two: "PLAYER_2",
        });
      }
    }

    expect(tournamentStatus).toBe("completed");
    expect(escrowService.completeTournament).toHaveBeenCalledWith(
      "TOURNAMENT_1",
      ["PLAYER_1"],
      [10000]
    );
    expect(gameModel.createGame).toHaveBeenCalledTimes(3);
    expect(tournamentModel.linkGameToMatch).toHaveBeenCalledTimes(3);
  });
});
