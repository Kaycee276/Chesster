const supabase = require("../config/supabase");
const { getPool } = require("../config/db");

const DEFAULT_TIMEOUT_MS = 2000;
const SLOW_QUERY_THRESHOLD_MS = 1000;
const DB_HEALTH_CACHE_TTL_MS = 3000;

let cachedDbHealth = null;
let cacheExpiresAt = 0;

function roundLatency(durationMs) {
  return Math.round(durationMs * 100) / 100;
}

function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Database health check timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function checkDbHealth({ client = supabase, timeoutMs = DEFAULT_TIMEOUT_MS, bypassCache = false } = {}) {
  const now = Date.now();
  if (!bypassCache && cachedDbHealth && now < cacheExpiresAt) {
    return { ...cachedDbHealth, cached: true };
  }

  const start = process.hrtime.bigint();

  try {
    const query = client.from("players").select("id").limit(1);
    const result = await withTimeout(query, timeoutMs);
    const latencyMs = roundLatency(Number(process.hrtime.bigint() - start) / 1e6);

    if (result?.error) throw new Error(result.error.message || "Database query failed");
    if (latencyMs >= SLOW_QUERY_THRESHOLD_MS) {
      const payload = {
        status: "unhealthy",
        latencyMs,
        error: `Database response exceeded ${SLOW_QUERY_THRESHOLD_MS}ms threshold`,
        pool: { active: null, idle: null },
      };
      cachedDbHealth = payload;
      cacheExpiresAt = Date.now() + DB_HEALTH_CACHE_TTL_MS;
      return payload;
    }

    const payload = {
      status: "healthy",
      latencyMs,
      pool: { active: null, idle: null },
    };
    cachedDbHealth = payload;
    cacheExpiresAt = Date.now() + DB_HEALTH_CACHE_TTL_MS;
    return payload;
  } catch (error) {
    const latencyMs = roundLatency(Number(process.hrtime.bigint() - start) / 1e6);
    const payload = {
      status: "unhealthy",
      latencyMs,
      error: error instanceof Error ? error.message : "Database health check failed",
      pool: { active: null, idle: null },
    };
    cachedDbHealth = payload;
    cacheExpiresAt = Date.now() + DB_HEALTH_CACHE_TTL_MS;
    return payload;
  }
}

function clearDbHealthCache() {
  cachedDbHealth = null;
  cacheExpiresAt = 0;
}

function getPoolMetrics(pool = getPool()) {
	return {
		total: pool.totalCount,
		idle: pool.idleCount,
		waiting: pool.waitingCount,
		timestamp: new Date().toISOString(),
	};
}

async function checkPostgresLatency(timeoutMs = 2000) {
	const start = process.hrtime.bigint();
	try {
		const { data, error } = await supabase
			.from("players")
			.select("id")
			.limit(1);

		if (error) {
			return {
				status: "unhealthy",
				service: "PostgreSQL",
				latencyMs: Math.round(Number(process.hrtime.bigint() - start) / 1e6 * 100) / 100,
				error: error.message,
			};
		}

		const latencyMs = Math.round(Number(process.hrtime.bigint() - start) / 1e6 * 100) / 100;
		return {
			status: "ok",
			service: "PostgreSQL",
			latencyMs,
		};
	} catch (err) {
		const latencyMs = Math.round(Number(process.hrtime.bigint() - start) / 1e6 * 100) / 100;
		return {
			status: "unhealthy",
			service: "PostgreSQL",
			latencyMs,
			error: err.message,
		};
	}
}

async function checkRedisLatency(timeoutMs = 2000) {
	if (!process.env.REDIS_URL) {
		return {
			status: "ok",
			service: "Redis",
			latencyMs: 0,
			configured: false,
		};
	}

	const start = process.hrtime.bigint();
	try {
		const client = await require("../config/redis").getRedisConnection(timeoutMs);
		if (!client) {
			return {
				status: "unhealthy",
				service: "Redis",
				latencyMs: Math.round(Number(process.hrtime.bigint() - start) / 1e6 * 100) / 100,
				error: `Redis connection timed out after ${timeoutMs}ms`,
			};
		}

		const timeoutPromise = new Promise((_, reject) => {
			const timer = setTimeout(() => reject(new Error(`Redis ping timed out`)), timeoutMs);
			return timer;
		});

		await Promise.race([client.ping(), timeoutPromise]);
		const latencyMs = Math.round(Number(process.hrtime.bigint() - start) / 1e6 * 100) / 100;
		return {
			status: "ok",
			service: "Redis",
			latencyMs,
		};
	} catch (err) {
		const latencyMs = Math.round(Number(process.hrtime.bigint() - start) / 1e6 * 100) / 100;
		return {
			status: "unhealthy",
			service: "Redis",
			latencyMs,
			error: err.message,
		};
	}
}

async function checkSorobanRpcLatency(timeoutMs = 2000) {
	const start = process.hrtime.bigint();
	try {
		const { rpc, Networks } = require("@stellar/stellar-sdk");
		const RPC_URL = process.env.STELLAR_RPC_URL || "https://soroban-testnet.stellar.org";
		const server = new rpc.Server(RPC_URL);

		const timeoutPromise = new Promise((_, reject) => {
			const timer = setTimeout(() => reject(new Error("Soroban RPC timeout")), timeoutMs);
			return timer;
		});

		await Promise.race([server.getLatestLedger(), timeoutPromise]);
		const latencyMs = Math.round(Number(process.hrtime.bigint() - start) / 1e6 * 100) / 100;
		return {
			status: "ok",
			service: "Soroban RPC",
			latencyMs,
		};
	} catch (err) {
		const latencyMs = Math.round(Number(process.hrtime.bigint() - start) / 1e6 * 100) / 100;
		return {
			status: "unhealthy",
			service: "Soroban RPC",
			latencyMs,
			error: err.message,
		};
	}
}

module.exports = {
  checkDbHealth,
  clearDbHealthCache,
  DEFAULT_TIMEOUT_MS,
  SLOW_QUERY_THRESHOLD_MS,
  DB_HEALTH_CACHE_TTL_MS,
  getPoolMetrics,
  checkPostgresLatency,
  checkRedisLatency,
  checkSorobanRpcLatency,
};
