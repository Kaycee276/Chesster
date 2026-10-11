/**
 * Health Check and Service Status Monitoring Routes
 * Provides diagnostic endpoints for service availability and dependencies
 */

const express = require("express");
const router = express.Router();
const supabase = require("../config/supabase");
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
 * GET /health/liveness
 * Lightweight liveness probe - confirms process alive without querying external dependencies
 */
router.get(["/health/liveness", "/liveness"], (req, res) => {
  const memUsage = process.memoryUsage();
  res.status(200).json({
    status: "ok",
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    memory: {
      rssMb: Math.round((memUsage.rss / 1024 / 1024) * 100) / 100,
      heapUsedMb: Math.round((memUsage.heapUsed / 1024 / 1024) * 100) / 100,
      heapTotalMb: Math.round((memUsage.heapTotal / 1024 / 1024) * 100) / 100,
    },
    environment: process.env.NODE_ENV || "development",
  });
});

/**
 * GET /health/readiness
 * Readiness probe with cached DB evaluation and strict 2s timeout
 */
router.get(["/health/readiness", "/readiness"], async (req, res) => {
  const dbHealth = await checkDbHealth();
  const isHealthy = dbHealth.status === "healthy";
  const statusCode = isHealthy ? 200 : 503;

  res.status(statusCode).json({
    status: isHealthy ? "ready" : "not_ready",
    timestamp: new Date().toISOString(),
    components: {
      database: dbHealth,
    },
  });
});

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