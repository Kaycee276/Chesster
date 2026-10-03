const express = require('express');
const client = require("prom-client");

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

router.get("/metrics", async (req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

router.register = register;
router.activeSocketConnections = activeSocketConnections;
router.activeGames = activeGames;
router.activeTournaments = activeTournaments;
router.moveLatency = moveLatency;
router.escrowSettlements = escrowSettlements;
router.setConnectedClients = setConnectedClients;
router.markGameConnected = markGameConnected;
router.markGameDisconnected = markGameDisconnected;
router.observeMoveLatency = observeMoveLatency;
router.recordEscrowSettlement = recordEscrowSettlement;

module.exports = router;
