const http = require('http');
const { Server } = require('socket.io');
const { io: Client } = require('socket.io-client');
const {
  moderateMessage,
  CHAT_RATE_LIMIT_MAX,
  CHAT_RATE_LIMIT_WINDOW_MS,
  CHAT_RATE_LIMIT_EVENT,
  consumeChatToken,
  enforceChatRateLimit,
  clearChatRateLimit,
  resetChatRateLimits,
  chatRateBuckets,
} = require('../services/chatService');

describe('chat moderation', () => {
  it('masks complete profane words before persistence or broadcast', () => {
    expect(moderateMessage('What the fuck is this?').message).toBe('What the **** is this?');
  });

  it('does not mask benign words containing blocked substrings', () => {
    expect(moderateMessage('classic pass button document').message).toBe('classic pass button document');
  });

  it('strips markup, control characters and enforces the length limit', () => {
    const result = moderateMessage('<b>Hello</b>\u0000 world');
    expect(result.message).toBe('Hello world');
    expect(moderateMessage('x'.repeat(501)).message).toHaveLength(500);
  });
});

describe('chat rate limiter', () => {
  const T0 = 1_000_000;
  const fakeSocket = (id = 'socket-1') => ({ id, emit: jest.fn() });

  afterEach(() => resetChatRateLimits());

  it('limits chat to 5 messages per rolling 10 second window', () => {
    expect(CHAT_RATE_LIMIT_MAX).toBe(5);
    expect(CHAT_RATE_LIMIT_WINDOW_MS).toBe(10_000);
  });

  it('accepts only the first 5 of 10 rapid messages and errors the rest', () => {
    const socket = fakeSocket();
    const results = Array.from({ length: 10 }, (_, i) => enforceChatRateLimit(socket, 'GAME1', { now: T0 + i * 10 }));

    expect(results).toEqual([true, true, true, true, true, false, false, false, false, false]);

    const errors = socket.emit.mock.calls.filter(([event]) => event === 'error');
    const limitEvents = socket.emit.mock.calls.filter(([event]) => event === CHAT_RATE_LIMIT_EVENT);
    expect(errors).toHaveLength(5);
    expect(limitEvents).toHaveLength(5);
    expect(errors[0][1]).toEqual({
      error: 'chat_rate_limit_exceeded',
      code: 'chat_rate_limit_exceeded',
      message: expect.stringContaining('Chat rate limit exceeded'),
      gameCode: 'GAME1',
      limit: 5,
      windowMs: 10_000,
      retryAfterMs: 10_000 - 50,
    });
  });

  it('slides the window so capacity returns as old messages expire', () => {
    for (let i = 0; i < 5; i += 1) consumeChatToken('s', 'GAME1', { now: T0 + i * 1000 });

    expect(consumeChatToken('s', 'GAME1', { now: T0 + 9_999 }).allowed).toBe(false);
    // The first message (T0) has left the window; exactly one slot is free.
    expect(consumeChatToken('s', 'GAME1', { now: T0 + 10_000 })).toEqual({ allowed: true, remaining: 0, retryAfterMs: 0 });
    expect(consumeChatToken('s', 'GAME1', { now: T0 + 10_001 }).allowed).toBe(false);
    expect(consumeChatToken('s', 'GAME1', { now: T0 + 11_000 }).allowed).toBe(true);
  });

  it('does not count rejected messages against the window', () => {
    for (let i = 0; i < 5; i += 1) consumeChatToken('s', 'GAME1', { now: T0 });
    for (let i = 0; i < 20; i += 1) consumeChatToken('s', 'GAME1', { now: T0 + 5_000 });

    expect(consumeChatToken('s', 'GAME1', { now: T0 + 10_001 }).allowed).toBe(true);
  });

  it('tracks sockets and game rooms independently', () => {
    for (let i = 0; i < 5; i += 1) consumeChatToken('a', 'GAME1', { now: T0 });

    expect(consumeChatToken('a', 'GAME1', { now: T0 }).allowed).toBe(false);
    expect(consumeChatToken('a', 'GAME2', { now: T0 }).allowed).toBe(true);
    expect(consumeChatToken('b', 'GAME1', { now: T0 }).allowed).toBe(true);
  });

  it('releases all bucket state for a socket on disconnect', () => {
    const socket = fakeSocket('leaky');
    for (let i = 0; i < 6; i += 1) enforceChatRateLimit(socket, 'GAME1', { now: T0 });
    enforceChatRateLimit(socket, 'GAME2', { now: T0 });

    expect(chatRateBuckets.has('leaky')).toBe(true);
    expect(clearChatRateLimit('leaky')).toBe(true);
    expect(chatRateBuckets.has('leaky')).toBe(false);
    expect(enforceChatRateLimit(socket, 'GAME1', { now: T0 })).toBe(true);
  });

  describe('over a real socket.io connection', () => {
    let httpServer;
    let io;
    let client;

    beforeEach(async () => {
      httpServer = http.createServer();
      io = new Server(httpServer);
      io.on('connection', (socket) => {
        socket.on('send-chat', ({ gameCode, message }) => {
          if (!enforceChatRateLimit(socket, gameCode)) return;
          socket.emit('chat-message', { message });
        });
        socket.on('disconnect', () => clearChatRateLimit(socket.id));
      });
      await new Promise((resolve) => httpServer.listen(0, resolve));
      client = Client(`http://127.0.0.1:${httpServer.address().port}`, { transports: ['websocket'] });
      await new Promise((resolve) => client.once('connect', resolve));
    });

    afterEach(async () => {
      client.close();
      io.close();
      await new Promise((resolve) => httpServer.close(resolve));
    });

    it('delivers 5 messages, sends structured errors for the next 5, and cleans up on disconnect', async () => {
      const accepted = [];
      const errors = [];
      client.on('chat-message', (payload) => accepted.push(payload));
      client.on('error', (payload) => errors.push(payload));
      const done = new Promise((resolve) => {
        const check = () => { if (accepted.length + errors.length === 10) resolve(); };
        client.on('chat-message', check);
        client.on('error', check);
      });

      for (let i = 0; i < 10; i += 1) client.emit('send-chat', { gameCode: 'GAME1', message: `msg ${i}` });
      await done;

      expect(accepted.map((payload) => payload.message)).toEqual(['msg 0', 'msg 1', 'msg 2', 'msg 3', 'msg 4']);
      expect(errors).toHaveLength(5);
      expect(errors.every((payload) => payload.code === CHAT_RATE_LIMIT_EVENT && payload.gameCode === 'GAME1')).toBe(true);

      const socketId = [...io.sockets.sockets.keys()][0];
      expect(chatRateBuckets.has(socketId)).toBe(true);
      const disconnected = new Promise((resolve) => io.sockets.sockets.get(socketId).once('disconnect', resolve));
      client.disconnect();
      await disconnected;
      expect(chatRateBuckets.has(socketId)).toBe(false);
    });
  });
});
