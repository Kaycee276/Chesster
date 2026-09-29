const { Server } = require("socket.io");
const { createAdapter } = require("@socket.io/redis-adapter");
const Redis = require("ioredis-mock");

describe("Socket.io Redis Adapter Integration", () => {
  it("should successfully initialize adapter with mock Redis clients", () => {
    const pubClient = new Redis();
    const subClient = pubClient.duplicate();
    const io = new Server();
    
    expect(() => {
      io.adapter(createAdapter(pubClient, subClient));
    }).not.toThrow();
  });
});
