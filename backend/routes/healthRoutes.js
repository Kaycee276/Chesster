/**
 * Health Check and Service Status Monitoring Routes
 * Provides diagnostic endpoints for service availability and dependencies
 */

const express = require("express");
const router = express.Router();
const supabase = require("../config/supabase");
const redisConfig = require("../config/redis");
const { checkDbHealth } = require("../services/dbHealthService");
const logger = require("../utils/logger");
const { Keypair, rpc, Networks } = require("@stellar/stellar-sdk");

const RPC_URL = process.env.STELLAR_RPC_URL || "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = process.env.STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET;

/**
 * Verify Neon PostgreSQL database connectivity
 * @returns {object} Database health status
 */
async function checkDatabaseHealth() {
  try {
    const startTime = Date.now();
    const { data, error } = await supabase
      .from("games")
      .select("count")
      .limit(1);

    if (error) {
      return {
        status: "unhealthy",
        database: "Neon PostgreSQL",
        error: error.message,
        responseTime: Date.now() - startTime,
      };
    }

    const responseTime = Date.now() - startTime;
    logger.logPerformance("Database health check", responseTime, {
      service: "Neon PostgreSQL",
    });

    return {
      status: "healthy",
      database: "Neon PostgreSQL",
      responseTime,
    };
  } catch (error) {
    logger.error("Database health check failed", error);
    return {
      status: "unhealthy",
      database: "Neon PostgreSQL",
      error: error.message,
    };
  }
}

/**
 * Verify Stellar RPC connectivity
 * @returns {object} Stellar RPC health status
 */
async function checkStellarRpcHealth() {
  try {
    const startTime = Date.now();
    const server = new rpc.Server(RPC_URL);
    
    // Test RPC connection with getLatestLedger
    const ledger = await server.getLatestLedger();
    
    const responseTime = Date.now() - startTime;
    logger.logPerformance("Stellar RPC health check", responseTime, {
      service: "Stellar Horizon RPC",
    });

    return {
      status: "healthy",
      service: "Stellar Horizon RPC",
      network: NETWORK_PASSPHRASE === Networks.TESTNET ? "testnet" : "mainnet",
      latestLedger: ledger.sequence,
      responseTime,
    };
  } catch (error) {
    logger.error("Stellar RPC health check failed", error);
    return {
      status: "unhealthy",
      service: "Stellar Horizon RPC",
      error: error.message,
    };
  }
}

/**
 * Verify Redis connectivity with a timeout
 * @param {number} timeoutMs
 * @returns {Promise<object>}
 */
async function checkRedisHealth(timeoutMs = 2000) {
  if (!process.env.REDIS_URL) {
    return {
      status: "healthy",
      service: "Redis",
      configured: false,
      message: "Redis disabled or not configured",
    };
  }
  const startTime = Date.now();
  let timer;
  try {
    const client = await redisConfig.getRedisConnection(timeoutMs);
    if (!client) {
      return {
        status: "unhealthy",
        service: "Redis",
        error: `Redis connection timed out after ${timeoutMs}ms`,
      };
    }
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Redis ping timed out after ${timeoutMs}ms`)), timeoutMs);
    });
    await Promise.race([client.ping(), timeoutPromise]);
    clearTimeout(timer);
    return {
      status: "healthy",
      service: "Redis",
      responseTime: Date.now() - startTime,
    };
  } catch (err) {
    clearTimeout(timer);
    return {
      status: "unhealthy",
      service: "Redis",
      error: err.message,
    };
  }
}

/**
 * GET /api/health
 * Basic health check endpoint - quick liveness probe
 */
router.get("/health", (req, res) => {
  logger.info("Health check requested");
  
  res.json({
    status: "ok",
    message: "Chesster backend is running",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || "development",
  });
});

/**
 * GET /api/health/liveness (and /health/liveness)
 * Liveness probe: returns HTTP 200 with process uptime, memory usage, and timestamp without querying external services.
 */
router.get(["/health/liveness", "/liveness"], (req, res) => {
  res.status(200).json({
    status: "ok",
    uptimeSeconds: Math.floor(process.uptime()),
    memoryUsage: process.memoryUsage(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /api/health/readiness (and /health/readiness)
 * Readiness probe: evaluates Neon PostgreSQL and Redis connectivity with a strict 2-second timeout per probe.
 */
router.get(["/health/readiness", "/readiness"], async (req, res) => {
  try {
    const [databaseHealth, redisHealth] = await Promise.all([
      checkDbHealth({ timeoutMs: 2000 }),
      checkRedisHealth(2000),
    ]);

    const isHealthy = databaseHealth.status === "healthy" && redisHealth.status === "healthy";
    const statusCode = isHealthy ? 200 : 503;

    return res.status(statusCode).json({
      status: isHealthy ? "healthy" : "unhealthy",
      timestamp: new Date().toISOString(),
      dependencies: {
        database: databaseHealth,
        redis: redisHealth,
      },
    });
  } catch (error) {
    logger.error("Readiness probe failed", error);
    return res.status(503).json({
      status: "unhealthy",
      timestamp: new Date().toISOString(),
      error: error.message,
    });
  }
});

/**
 * GET /api/health/detailed (and /health/detailed)
 * Detailed health probe across database, redis, and stellar horizon rpc.
 */
router.get(["/health/detailed", "/detailed"], async (req, res) => {
  try {
    const startTime = Date.now();
    const [databaseHealth, redisHealth, stellarRpcHealth] = await Promise.all([
      checkDbHealth({ timeoutMs: 2000 }),
      checkRedisHealth(2000),
      checkStellarRpcHealth(),
    ]);

    const overallHealth =
      databaseHealth.status === "healthy" &&
      redisHealth.status === "healthy" &&
      stellarRpcHealth.status === "healthy"
        ? "healthy"
        : "degraded";

    const statusCode = overallHealth === "healthy" ? 200 : 503;
    return res.status(statusCode).json({
      status: overallHealth,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      memoryUsage: process.memoryUsage(),
      services: {
        database: databaseHealth,
        redis: redisHealth,
        stellarRpc: stellarRpcHealth,
      },
      durationMs: Date.now() - startTime,
    });
  } catch (error) {
    logger.error("Detailed health check failed", error);
    return res.status(503).json({
      status: "error",
      timestamp: new Date().toISOString(),
      error: error.message,
    });
  }
});

/**
 * GET /api/health/db
 * Database readiness probe with latency and pool diagnostics.
 */
router.get("/health/db", async (req, res) => {
	const health = await checkDbHealth();
	res.status(health.status === "healthy" ? 200 : 503).json(health);
});

/**
 * GET /api/status
 * Comprehensive status check - tests all service dependencies
 */
router.get("/status", async (req, res) => {
  logger.info("Comprehensive status check requested");

  try {
    const startTime = Date.now();

    // Check all services in parallel
    const [databaseHealth, stellarRpcHealth] = await Promise.all([
      checkDatabaseHealth(),
      checkStellarRpcHealth(),
    ]);

    const totalDuration = Date.now() - startTime;
    const overallHealth =
      databaseHealth.status === "healthy" && stellarRpcHealth.status === "healthy"
        ? "healthy"
        : "degraded";

    const response = {
      status: overallHealth,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || "development",
      services: {
        database: databaseHealth,
        stellarRpc: stellarRpcHealth,
      },
      totalCheckDuration: totalDuration,
    };

    logger.info("Status check completed", {
      overallHealth,
      durationMs: totalDuration,
    });

    const statusCode = overallHealth === "healthy" ? 200 : 503;
    res.status(statusCode).json(response);
  } catch (error) {
    logger.error("Status check failed", error);
    res.status(500).json({
      status: "error",
      message: "Status check encountered an error",
      timestamp: new Date().toISOString(),
      error: error.message,
    });
  }
});

/**
 * GET /api/status/database
 * Isolated database health check
 */
router.get("/status/database", async (req, res) => {
  try {
    const health = await checkDatabaseHealth();
    const statusCode = health.status === "healthy" ? 200 : 503;
    res.status(statusCode).json(health);
  } catch (error) {
    logger.error("Database status check failed", error);
    res.status(500).json({
      status: "error",
      error: error.message,
    });
  }
});

/**
 * GET /api/status/stellar
 * Isolated Stellar RPC health check
 */
router.get("/status/stellar", async (req, res) => {
  try {
    const health = await checkStellarRpcHealth();
    const statusCode = health.status === "healthy" ? 200 : 503;
    res.status(statusCode).json(health);
  } catch (error) {
    logger.error("Stellar status check failed", error);
    res.status(500).json({
      status: "error",
      error: error.message,
    });
  }
});

module.exports = router;
