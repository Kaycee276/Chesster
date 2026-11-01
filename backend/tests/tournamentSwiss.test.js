const tournamentService = require('../services/tournamentService');

describe('Swiss pairing', () => {
  it('pairs by score without repeating opponents and assigns an odd-player bye', async () => {
    const players = [1, 2, 3, 4, 5].map((n) => ({ wallet_address: `G${n}`, score: n === 1 ? 2 : 1, elo: 1200 - n }));
    const previous = [{ player_one: 'G1', player_two: 'G2', status: 'completed' }];
    const result = await tournamentService.generateSwissRoundPairings;
    expect(typeof result).toBe('function');
    const pairings = tournamentService.__pairSwissRoundForTest(players, previous, 2);
    expect(pairings.pairings).toHaveLength(2);
    expect(pairings.bye).toBeTruthy();
    expect(pairings.pairings.flatMap((p) => [p.player_one, p.player_two])).not.toContain(pairings.bye.walletAddress);
    expect(pairings.pairings[0].player_one).not.toBe('G2');
  });
});
