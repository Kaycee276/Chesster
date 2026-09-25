const supabase = require("../config/supabase");

const DEFAULT_TIMEOUT_MS = 2000;
const SLOW_QUERY_THRESHOLD_MS = 1000;

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

async function checkDbHealth({ client = supabase, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const start = process.hrtime.bigint();

  try {
    const query = client.from("players").select("id").limit(1);
    const result = await withTimeout(query, timeoutMs);
    const latencyMs = roundLatency(Number(process.hrtime.bigint() - start) / 1e6);

    if (result?.error) throw new Error(result.error.message || "Database query failed");
    if (latencyMs >= SLOW_QUERY_THRESHOLD_MS) {
      return {
        status: "unhealthy",
        latencyMs,
        error: `Database response exceeded ${SLOW_QUERY_THRESHOLD_MS}ms threshold`,
        pool: { active: null, idle: null },
      };
    }

    return {
      status: "healthy",
      latencyMs,
      pool: { active: null, idle: null },
    };
  } catch (error) {
    const latencyMs = roundLatency(Number(process.hrtime.bigint() - start) / 1e6);
    return {
      status: "unhealthy",
      latencyMs,
      error: error instanceof Error ? error.message : "Database health check failed",
      pool: { active: null, idle: null },
    };
  }
}

module.exports = { checkDbHealth, DEFAULT_TIMEOUT_MS, SLOW_QUERY_THRESHOLD_MS };
