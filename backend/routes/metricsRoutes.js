const express = require('express');
const client = require('prom-client');

const router = express.Router();

// Create a Registry to register metrics
const register = new client.Registry();

// Add default metrics (CPU, memory, event loop lag, etc.)
client.collectDefaultMetrics({ register });

// Custom gauge to track active socket connections
const activeSocketConnections = new client.Gauge({
  name: 'socket_active_connections',
  help: 'Number of active Socket.IO connections',
  registers: [register]
});

// Expose the register to the router so server.js can update socket counts
router.register = register;
router.activeSocketConnections = activeSocketConnections;

// Metrics endpoint
router.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

module.exports = router;