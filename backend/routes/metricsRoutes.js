const express = require("express");
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

// Issue #659: Custom Prometheus metric collectors
const matchmakingWaitHistogram = new client.Histogram({
  name: "chesster_matchmaking_wait_seconds",
  help: "Duration in seconds players spend waiting in the matchmaking queue",
  buckets: [2, 5, 10, 20, 30, 60, 120],
  registers: [register],
});

const activeGamesGauge = new client.Gauge({
  name: "chesster_active_games_total",
  help: "Number of active chess matches currently ongoing",
  labelNames: ["variant"],
  registers: [register],
});

const connectedSpectatorsGauge = new client.Gauge({
  name: "chesster_connected_spectators_total",
  help: "Number of connected spectators",
  registers: [register],
});

// Initialize default variant counters and spectators
["standard", "blitz", "bullet"].forEach((variant) => {
  activeGamesGauge.set({ variant }, 0);
});
connectedSpectatorsGauge.set(0);

const activeGameCodes = new Set();
const activeGameVariants = new Map();

function setConnectedClients(value) {
  const count = Math.max(0, Number(value) || 0);
  connectedClients.set(count);
  activeSocketConnections.set(count);
}

function _refreshActiveGamesByVariant() {
  const counts = { standard: 0, blitz: 0, bullet: 0 };
  for (const variant of activeGameVariants.values()) {
    counts[variant] = (counts[variant] || 0) + 1;
  }
  for (const [variant, count] of Object.entries(counts)) {
    activeGamesGauge.set({ variant }, count);
  }
}

function markGameConnected(gameCode, variant = "standard") {
  if (gameCode) {
    const code = String(gameCode);
    const v = String(variant || "standard").toLowerCase();
    activeGameCodes.add(code);
    activeGameVariants.set(code, v);
  }
  activeGames.set(activeGameCodes.size);
  _refreshActiveGamesByVariant();
}

function markGameDisconnected(gameCode) {
  if (gameCode) {
    const code = String(gameCode);
    activeGameCodes.delete(code);
    activeGameVariants.delete(code);
  }
  activeGames.set(activeGameCodes.size);
  _refreshActiveGamesByVariant();
}

function observeMoveLatency(startTime) {
  if (typeof startTime === "number")
    moveLatency.observe(Math.max(0, (Date.now() - startTime) / 1000));
}

function recordEscrowSettlement(status) {
  if (["success", "failure"].includes(status)) escrowSettlements.inc({ status });
}

function observeMatchmakingWait(durationInSeconds) {
  if (typeof durationInSeconds === "number" && !isNaN(durationInSeconds)) {
    matchmakingWaitHistogram.observe(Math.max(0, durationInSeconds));
  }
}

function setActiveGames(variant, count) {
  const v = String(variant || "standard").toLowerCase();
  activeGamesGauge.set({ variant: v }, Math.max(0, Number(count) || 0));
}

function updateActiveGames(variant, count) {
  setActiveGames(variant, count);
}

function incrementActiveGames(variant) {
  const v = String(variant || "standard").toLowerCase();
  activeGamesGauge.inc({ variant: v });
}

function decrementActiveGames(variant) {
  const v = String(variant || "standard").toLowerCase();
  activeGamesGauge.dec({ variant: v });
}

let spectatorCount = 0;
function setConnectedSpectators(value) {
  spectatorCount = Math.max(0, Number(value) || 0);
  connectedSpectatorsGauge.set(spectatorCount);
}

function markSpectatorConnected() {
  spectatorCount++;
  connectedSpectatorsGauge.set(spectatorCount);
}

function markSpectatorDisconnected() {
  spectatorCount = Math.max(0, spectatorCount - 1);
  connectedSpectatorsGauge.set(spectatorCount);
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

// Issue #659 exports
router.matchmakingWaitHistogram = matchmakingWaitHistogram;
router.activeGamesGauge = activeGamesGauge;
router.connectedSpectatorsGauge = connectedSpectatorsGauge;
router.observeMatchmakingWait = observeMatchmakingWait;
router.setActiveGames = setActiveGames;
router.updateActiveGames = updateActiveGames;
router.incrementActiveGames = incrementActiveGames;
router.decrementActiveGames = decrementActiveGames;
router.setConnectedSpectators = setConnectedSpectators;
router.markSpectatorConnected = markSpectatorConnected;
router.markSpectatorDisconnected = markSpectatorDisconnected;

module.exports = router;
