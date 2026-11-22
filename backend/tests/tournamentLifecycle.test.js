// Exercise real HTTP handlers, pairing/advancement services and Socket.IO delivery.
// Database and on-chain SDK boundaries are fixtures; this is not a deployed Swiss E2E.
jest.mock("@stellar/stellar-sdk", () => ({
  Keypair: { fromPublicKey: jest.fn(() => ({ verify: () => true })) },
}));
jest.mock("../config/supabase", () => ({ from: jest.fn() }));
jest.mock("../models/gameModel", () => ({ createGame: jest.fn(), joinGame: jest.fn() }));
jest.mock("../services/escrowService", () => ({ completeTournament: jest.fn() }));
jest.mock("../services/replayService", () => ({}));
jest.mock("../services/leaderboardService", () => ({
  invalidateLeaderboardCache: jest.fn().mockResolvedValue(),
}));

const http = require("node:http");
const express = require("express");
const request = require("supertest");
const { Server } = require("socket.io");
const { io: connect } = require("socket.io-client");
const database = require("../config/supabase");
const model = require("../models/tournamentModel");
const service = require("../services/tournamentService");
const gameModel = require("../models/gameModel");
const escrow = require("../services/escrowService");
const routes = require("../routes/tournamentRoutes");

const ID = "76500000-0000-4000-8000-000000000001";
const wallets = ["A", "B", "C", "D"].map((letter) => `G${letter.repeat(55)}`);

function waitFor(socket, event) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(event, receive);
      reject(new Error(`Timed out waiting for ${event}`));
    }, 3000);
    function receive(payload) {
      clearTimeout(timeout);
      resolve(payload);
    }
    socket.once(event, receive);
  });
}

function installStorage() {
  let state = { tournament: null, participants: [], matches: [] };
  const snapshot = () => structuredClone(state);
  const replaceMatch = (id, fields) => {
    state = { ...state, matches: state.matches.map((m) => m.id === id ? { ...m, ...fields } : m) };
    return snapshot().matches.find((m) => m.id === id);
  };
  database.from.mockImplementation(() => ({
    insert: (payload) => ({ select: () => ({ single: async () => {
      state = { ...state, tournament: { ...payload } };
      return { data: snapshot().tournament, error: null };
    } }) }),
  }));
  jest.spyOn(model, "getTournament").mockImplementation(async () => snapshot().tournament);
  jest.spyOn(model, "getParticipants").mockImplementation(async () => snapshot().participants);
  jest.spyOn(model, "countParticipants").mockImplementation(async () => state.participants.length);
  jest.spyOn(model, "isParticipant").mockImplementation(async (_id, address) =>
    state.participants.some((p) => p.wallet_address === address));
  jest.spyOn(model, "addParticipant").mockImplementation(async (_id, address, seed) => {
    const participant = { tournament_id: ID, wallet_address: address, seed, score: 0, elo: 1900 - seed * 100 };
    state = { ...state, participants: [...state.participants, participant] };
    return structuredClone(participant);
  });
  jest.spyOn(model, "getBracketMatches").mockImplementation(async () => snapshot().matches);
  jest.spyOn(model, "createBracketMatches").mockImplementation(async (rows) => {
    const added = rows.map((row, i) => ({ ...row, id: `match-${state.matches.length + i + 1}` }));
    state = { ...state, matches: [...state.matches, ...added] };
    return structuredClone(added);
  });
  jest.spyOn(model, "getMatchById").mockImplementation(async (id) =>
    snapshot().matches.find((m) => m.id === id));
  jest.spyOn(model, "setMatchWinner").mockImplementation(async (id, winner) =>
    replaceMatch(id, { winner, status: "completed" }));
  jest.spyOn(model, "getNextRoundMatch").mockImplementation(async (_id, matchId) => {
    const match = state.matches.find((m) => m.id === matchId);
    return snapshot().matches.find((m) => m.round === match.round + 1 &&
      m.match_number === Math.ceil(match.match_number / 2)) || null;
  });
  jest.spyOn(model, "assignPlayerToMatch").mockImplementation(async (id, player, slot) =>
    replaceMatch(id, { [slot]: player }));
  jest.spyOn(model, "linkGameToMatch").mockImplementation(async (id, code) =>
    replaceMatch(id, { game_code: code, status: "in_progress" }));
  jest.spyOn(model, "updateTournamentStatus").mockImplementation(async (_id, status) => {
    state = { ...state, tournament: { ...state.tournament, status } };
    return snapshot().tournament;
  });
  jest.spyOn(model, "updateParticipantScore").mockImplementation(async (_id, address, { scoreDelta }) => {
    state = { ...state, participants: state.participants.map((p) => p.wallet_address === address ?
      { ...p, score: p.score + scoreDelta } : p) };
    return snapshot().participants.find((p) => p.wallet_address === address);
  });
  gameModel.createGame.mockResolvedValue({ game_code: "FINAL765" });
  gameModel.joinGame.mockResolvedValue({});
  escrow.completeTournament.mockResolvedValue("fixture-payout-transaction");
  return { snapshot };
}

async function createHarness() {
  const app = express();
  app.use(express.json());
  app.use("/api", routes);
  app.use((error, _req, res, _next) => res.status(500).json({ success: false, error: error.message }));
  const server = http.createServer(app);
  const io = new Server(server);
  // Test transport setup joins rooms with acknowledgements, avoiding arbitrary sleeps.
  io.on("connection", (socket) => {
    socket.on("join-test-tournament", async (id, acknowledge) => {
      await socket.join(`tournament:${id}`);
      acknowledge();
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { app, io, url, close: () => new Promise((resolve) => io.close(resolve)) };
}

describe("four-player tournament integration", () => {
  let storage;
  let harness;
  let clients;

  beforeEach(async () => {
    jest.clearAllMocks();
    storage = installStorage();
    clients = [];
    harness = await createHarness();
    await model.createTournament({ id: ID, name: "Lifecycle Cup", maxPlayers: 4, entryFee: 10, prizePool: 40 });
  });

  afterEach(async () => {
    clients.forEach((client) => client.disconnect());
    if (harness) await harness.close();
    jest.restoreAllMocks();
  });

  async function registerFourPlayers() {
    for (const address of wallets) {
      const client = connect(harness.url, { autoConnect: false, transports: ["websocket"], reconnection: false });
      clients = [...clients, client];
      const connected = waitFor(client, "connect");
      client.connect();
      await connected;
      await client.timeout(3000).emitWithAck("join-test-tournament", ID);
      const response = await request(harness.app).post(`/api/tournaments/${ID}/register`)
        .send({ walletAddress: address, signature: "fixture-wallet-signature" });
      expect(response.status).toBe(201);
      expect(response.body.participantCount).toBe(clients.length);
    }
  }

  async function publishToAll(event, publish, payload) {
    const deliveries = clients.map((client) => waitFor(client, event));
    publish(harness.io, ID, payload);
    const observed = await Promise.all(deliveries);
    observed.forEach((message) => expect(message).toMatchObject({ tournamentId: ID, ...payload }));
  }

  test("registers four sessions, pairs winners in Swiss round two and computes final tiebreaks", async () => {
    await registerFourPlayers();
    const duplicate = await request(harness.app).post(`/api/tournaments/${ID}/register`)
      .send({ walletAddress: wallets[0], signature: "fixture-wallet-signature" });
    expect(duplicate.status).toBe(409);
    expect(storage.snapshot().participants).toHaveLength(4);

    const roundOne = await service.generateSwissRoundPairings(ID, 1);
    expect(roundOne.bye).toBeNull();
    expect(roundOne.pairings.map((m) => [m.player_one, m.player_two])).toEqual([
      [wallets[0], wallets[1]], [wallets[2], wallets[3]],
    ]);
    // Persistence/scoring coordination is a fixture because no production Swiss coordinator exists.
    const firstMatches = await model.createBracketMatches(roundOne.pairings.map((m, i) =>
      ({ ...m, tournament_id: ID, match_number: i + 1 })));
    await publishToAll("tournament:bracket_generated", service.emitBracketGenerated,
      { round: 1, pairings: firstMatches });
    expect(await service.checkRoundCompletion(ID, 1)).toBe(false);
    for (const [index, winner] of [[0, wallets[0]], [1, wallets[2]]]) {
      await model.setMatchWinner(firstMatches[index].id, winner);
      await model.updateParticipantScore(ID, winner, { scoreDelta: 1 });
    }
    expect(await service.checkRoundCompletion(ID, 1)).toBe(true);

    const roundTwo = await service.generateSwissRoundPairings(ID, 2);
    expect(roundTwo.pairings.map((m) => [m.player_one, m.player_two].sort())).toEqual([
      [wallets[0], wallets[2]].sort(), [wallets[1], wallets[3]].sort(),
    ]);
    const secondMatches = await model.createBracketMatches(roundTwo.pairings.map((m, i) =>
      ({ ...m, tournament_id: ID, match_number: i + 1 })));
    await publishToAll("tournament:match_ready", service.emitMatchReady,
      { round: 2, pairings: secondMatches });
    for (const [index, winner] of [[0, wallets[0]], [1, wallets[1]]]) {
      await model.setMatchWinner(secondMatches[index].id, winner);
      await model.updateParticipantScore(ID, winner, { scoreDelta: 1 });
    }
    expect(await service.checkRoundCompletion(ID, 2)).toBe(true);
    const finalState = storage.snapshot();
    const standings = service.calculateTiebreaks(finalState.participants, finalState.matches);
    expect(standings.map((p) => [p.wallet_address, p.score, p.buchholz, p.rank])).toEqual([
      [wallets[0], 2, 2, 1], [wallets[1], 1, 2, 2],
      [wallets[2], 1, 2, 3], [wallets[3], 0, 2, 4],
    ]);
    const response = await request(harness.app).get(`/api/tournaments/${ID}/bracket`);
    expect(response.status).toBe(200);
    expect(response.body.bracket.rounds.map((r) => r.matches.length)).toEqual([2, 2]);
    const detail = await request(harness.app).get(`/api/tournaments/${ID}`);
    expect(detail.status).toBe(200);
    expect(detail.body.tournament.bracket_matches).toHaveLength(4);
    expect(detail.body.tournament.participantCount).toBe(4);
    // Never settle a Swiss round using the single-elimination championship path.
    expect(escrow.completeTournament).not.toHaveBeenCalled();
  });

  test("advances the available elimination lifecycle and invokes the winner-takes-all escrow boundary", async () => {
    await registerFourPlayers();
    const matches = await service.generateSingleEliminationBracket(ID, storage.snapshot().participants);
    expect(matches).toHaveLength(3);
    const first = matches.filter((m) => m.round === 1);
    await service.advanceMatchWinner(ID, first[0].id, wallets[0]);
    expect(escrow.completeTournament).not.toHaveBeenCalled();
    const next = await service.advanceMatchWinner(ID, first[1].id, wallets[1]);
    expect(next.gameCode).toBe("FINAL765");
    expect(gameModel.joinGame).toHaveBeenCalledWith("FINAL765", "black", wallets[1]);
    const final = storage.snapshot().matches.find((m) => m.round === 2);
    expect([final.player_one, final.player_two]).toEqual([wallets[0], wallets[1]]);
    const result = await service.advanceMatchWinner(ID, final.id, wallets[0]);
    expect(result).toMatchObject({ isChampionship: true, escrowTx: "fixture-payout-transaction" });
    expect(storage.snapshot().tournament.status).toBe("completed");
    expect(escrow.completeTournament).toHaveBeenCalledTimes(1);
    expect(escrow.completeTournament).toHaveBeenCalledWith(ID, [wallets[0]], [10000]);
    await publishToAll("tournament:completed", service.emitTournamentCompleted,
      { winnerAddress: wallets[0], prizePool: 40, payoutTx: result.escrowTx });
  });
});


describe("tournament model adapters used by the REST lifecycle", () => {
  afterEach(() => jest.restoreAllMocks());

  test("detail lookup delegates to the existing tournament query", async () => {
    const lookup = jest.spyOn(model, "getTournament").mockResolvedValue({ id: ID });
    await expect(model.getTournamentById(ID)).resolves.toEqual({ id: ID });
    expect(lookup).toHaveBeenCalledWith(ID);
  });

  test("participant count scopes an exact head-only query to its tournament", async () => {
    const select = jest.fn();
    const eq = jest.fn().mockResolvedValue({ count: 4, error: null });
    select.mockReturnValue({ eq });
    database.from.mockReturnValue({ select });
    await expect(model.countParticipants(ID)).resolves.toBe(4);
    expect(database.from).toHaveBeenCalledWith("tournament_participants");
    expect(select).toHaveBeenCalledWith("id", { count: "exact", head: true });
    expect(eq).toHaveBeenCalledWith("tournament_id", ID);
  });

  test.each([null, { wallet_address: wallets[0] }])("participant existence handles %p", async (data) => {
    const maybeSingle = jest.fn().mockResolvedValue({ data, error: null });
    const addressFilter = jest.fn().mockReturnValue({ maybeSingle });
    const tournamentFilter = jest.fn().mockReturnValue({ eq: addressFilter });
    database.from.mockReturnValue({ select: () => ({ eq: tournamentFilter }) });
    await expect(model.isParticipant(ID, wallets[0])).resolves.toBe(Boolean(data));
    expect(tournamentFilter).toHaveBeenCalledWith("tournament_id", ID);
    expect(addressFilter).toHaveBeenCalledWith("wallet_address", wallets[0]);
  });

  test("participant count propagates database failures", async () => {
    const error = new Error("database unavailable");
    database.from.mockReturnValue({ select: () => ({ eq: async () => ({ error }) }) });
    await expect(model.countParticipants(ID)).rejects.toBe(error);
  });
});
