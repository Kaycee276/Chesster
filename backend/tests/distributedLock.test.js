const { withLock } = require('../utils/distributedLock');
const { getRedisClient } = require('../config/redis');

jest.mock('../config/redis', () => ({
  getRedisClient: jest.fn()
}));

describe('Distributed Lock', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should execute functions serially with in-memory fallback', async () => {
    getRedisClient.mockReturnValue(null);
    let concurrentCount = 0;
    
    const task = async () => {
      concurrentCount++;
      await new Promise(resolve => setTimeout(resolve, 50));
      concurrentCount--;
      return true;
    };
    
    const promises = [
      withLock('game1', 2000, task).catch(e => e.message),
      withLock('game1', 2000, task).catch(e => e.message)
    ];
    
    const results = await Promise.all(promises);
    expect(results).toContain('Concurrent move in progress, try again');
    expect(results).toContain(true);
    expect(concurrentCount).toBe(0);
  });
});
