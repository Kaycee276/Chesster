const timerService = require('../services/timerService');
const server = require('../server'); // just to ensure no syntax errors

describe('Disconnect Grace Period', () => {
  it('should start grace period on disconnect and cancel on reconnect', () => {
    timerService.startReconnectGrace('game1', 'white', 60);
    expect(timerService.isPendingForfeit('game1', 'white')).toBe(true);
    timerService.cancelReconnectGrace('game1', 'white');
    expect(timerService.isPendingForfeit('game1', 'white')).toBe(false);
  });
});
