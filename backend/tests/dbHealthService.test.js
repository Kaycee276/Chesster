const { checkDbHealth, clearDbHealthCache, getPoolMetrics } = require("../services/dbHealthService");

function createClient(result, delayMs = 0) {
  return {
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        limit: jest.fn(() => new Promise((resolve) => setTimeout(() => resolve(result), delayMs))),
      })),
    })),
  };
}

describe("Database health probe", () => {
  beforeEach(() => {
    clearDbHealthCache();
  });
  it("reports a healthy response with latency metrics", async () => {
    const health = await checkDbHealth({
      client: createClient({ data: [{ id: 1 }], error: null }),
    });

    expect(health.status).toBe("healthy");
    expect(typeof health.latencyMs).toBe("number");
    expect(health.pool).toEqual({ active: null, idle: null });
  });

  it("reports database errors as unhealthy", async () => {
    const health = await checkDbHealth({
      client: createClient({ data: null, error: { message: "connection refused" } }),
    });

    expect(health.status).toBe("unhealthy");
    expect(health.error).toBe("connection refused");
  });

  it("reports a timeout as unhealthy", async () => {
    const health = await checkDbHealth({
      client: createClient({ data: [{ id: 1 }], error: null }, 50),
      timeoutMs: 5,
    });

    expect(health.status).toBe("unhealthy");
    expect(health.error).toContain("timed out");
  });
});

describe("PostgreSQL pool metrics", () => {
	it("returns active pool counts without querying the database", () => {
		const metrics = getPoolMetrics({ totalCount: 8, idleCount: 3, waitingCount: 2 });

		expect(metrics).toMatchObject({ total: 8, idle: 3, waiting: 2 });
		expect(Number.isNaN(Date.parse(metrics.timestamp))).toBe(false);
	});
});
