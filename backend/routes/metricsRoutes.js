const express = require('express');
const client = require("prom-client");
const redisConfig = require("../config/redis");

const router = express.Router();
const register = new client.Registry();
client.collectDefaultMetrics({ register });

const activeGames = new client.Gauge({
  name: "chesster_active_games",
  help: "Number of games with at least one connected player",
  registers: [register],
});
const connectedClients = new client.Gauge({
  name: "chesster_connected_clients",
  help: "Number of connected Socket.IO clients",
  registers: [register],
});
const activeSocketConnections = new client.Gauge({
  name: "socket_active_connections",
  help: "Number of active Socket.IO connections (legacy name)",
  registers: [register],
});
const activeTournaments = new client.Gauge({
  name: "chesster_active_tournaments",
  help: "Number of active tournaments",
  registers: [register],
});
const moveLatency = new client.Histogram({
  name: "chesster_move_latency_seconds",
  help: "Time spent processing a move in seconds",
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [register],
});
const escrowSettlements = new client.Counter({
  name: "chesster_escrow_settlements_total",
  help: "Escrow settlement attempts",
  labelNames: ["status"],
  registers: [register],
});
const redisPingLatencyMs = new client.Gauge({
  name: "chesster_redis_ping_latency_ms",
  help: "Redis PING round-trip latency in milliseconds",
  registers: [register],
});
const redisConnectedClients = new client.Gauge({
  name: "chesster_redis_connected_clients",
  help: "Number of connected Redis clients",
  registers: [register],
});
const redisUsedMemoryBytes = new client.Gauge({
  name: "chesster_redis_used_memory_bytes",
  help: "Redis used memory in bytes",
  registers: [register],
});
const redisIsConnected = new client.Gauge({
  name: "chesster_redis_is_connected",
  help: "Whether Redis is currently connected (1 = connected, 0 = disconnected)",
  registers: [register],
});

const activeGameCodes = new Set();

function setConnectedClients(value) {
  const count = Math.max(0, Number(value) || 0);
  connectedClients.set(count);
  activeSocketConnections.set(count);
}

function markGameConnected(gameCode) {
  if (gameCode) activeGameCodes.add(String(gameCode));
  activeGames.set(activeGameCodes.size);
}

function markGameDisconnected(gameCode) {
  if (gameCode) activeGameCodes.delete(String(gameCode));
  activeGames.set(activeGameCodes.size);
}

function observeMoveLatency(startTime) {
  if (typeof startTime === "number") moveLatency.observe(Math.max(0, (Date.now() - startTime) / 1000));
}

function recordEscrowSettlement(status) {
  if (["success", "failure"].includes(status)) escrowSettlements.inc({ status });
}

async function collectRedisMetrics(redisClient) {
  try {
    const info = await redisConfig.getRedisHealthInfo(redisClient);
    if (info && info.connected) {
      redisIsConnected.set(1);
      redisPingLatencyMs.set(typeof info.pingLatencyMs === "number" ? info.pingLatencyMs : 0);
      redisConnectedClients.set(typeof info.connectedClients === "number" ? info.connectedClients : 0);
      redisUsedMemoryBytes.set(typeof info.usedMemoryBytes === "number" ? info.usedMemoryBytes : 0);
    } else {
      redisIsConnected.set(0);
      redisPingLatencyMs.set(0);
      redisConnectedClients.set(0);
      redisUsedMemoryBytes.set(0);
    }
    return info;
  } catch (_) {
    redisIsConnected.set(0);
    redisPingLatencyMs.set(0);
    redisConnectedClients.set(0);
    redisUsedMemoryBytes.set(0);
    return {
      connected: false,
      pingLatencyMs: null,
      connectedClients: null,
      usedMemoryBytes: null,
    };
  }
}

router.get("/metrics", async (req, res) => {
  await collectRedisMetrics();
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

router.register = register;
router.activeSocketConnections = activeSocketConnections;
router.activeGames = activeGames;
router.activeTournaments = activeTournaments;
router.moveLatency = moveLatency;
router.escrowSettlements = escrowSettlements;
router.redisPingLatencyMs = redisPingLatencyMs;
router.redisConnectedClients = redisConnectedClients;
router.redisUsedMemoryBytes = redisUsedMemoryBytes;
router.redisIsConnected = redisIsConnected;
router.setConnectedClients = setConnectedClients;
router.markGameConnected = markGameConnected;
router.markGameDisconnected = markGameDisconnected;
router.observeMoveLatency = observeMoveLatency;
router.recordEscrowSettlement = recordEscrowSettlement;
router.collectRedisMetrics = collectRedisMetrics;

module.exports = router;
