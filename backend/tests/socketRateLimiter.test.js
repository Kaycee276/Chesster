const http = require("node:http");
const { Server } = require("socket.io");
const { io: Client } = require("socket.io-client");
const Redis = require("ioredis-mock");
const { createSocketRateLimiter, getClientIp } = require("../middleware/socketRateLimiter");

function mockReq(overrides = {}) {
	return { headers: {}, socket: { remoteAddress: "203.0.113.5" }, ...overrides };
}
function mockRes() {
	return { writeHead: jest.fn(), end: jest.fn() };
}

function handshakeRequest(url, upgrade = false) {
	return new Promise((resolve, reject) => {
		const req = http.get(`${url}/socket.io/?EIO=4&transport=${upgrade ? "websocket" : "polling"}`, {
			headers: upgrade ? {
				Connection: "Upgrade", Upgrade: "websocket",
				"Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
			} : {},
		}, (res) => {
			let body = "";
			res.on("data", (chunk) => { body += chunk; });
			res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
		});
		req.on("upgrade", (res, socket) => {
			socket.destroy();
			resolve({ status: res.statusCode });
		});
		req.on("error", reject);
	});
}

describe("WebSocket handshake token bucket", () => {
	let redis;
	let timestamp;
	let limiter;
	beforeEach(async () => {
		redis = new Redis();
		await redis.flushall();
		timestamp = Date.now();
		limiter = createSocketRateLimiter({ getRedis: () => redis, now: () => timestamp });
	});
	afterEach(() => redis.disconnect());
	const attempt = (limiter, ip = "203.0.113.5") => limiter.checkHandshakeRateLimit(ip);

	test("allows 30 attempts and rejects the 31st with HTTP 429", async () => {
		for (let i = 0; i < 30; i++) expect((await attempt(limiter)).allowed).toBe(true);
		const next = jest.fn();
		const res = mockRes();
		await limiter(mockReq(), res, next);
		expect(next).not.toHaveBeenCalled();
		expect(res.writeHead).toHaveBeenCalledWith(429, { "Content-Type": "application/json", "Retry-After": "2" });
		expect(JSON.parse(res.end.mock.calls[0][0])).toEqual({ success: false, error: "Too many connection attempts" });
	});

	test("shares the limit atomically across instances under concurrent requests", async () => {
		const other = createSocketRateLimiter({ getRedis: () => redis, now: () => timestamp });
		const results = await Promise.all(Array.from({ length: 40 }, (_, i) => attempt(i % 2 ? limiter : other)));
		expect(results.filter((result) => result.allowed)).toHaveLength(30);
		expect(results.filter((result) => !result.allowed)).toHaveLength(10);
	});

	test("refills one token every two seconds and never exceeds the capacity", async () => {
		for (let i = 0; i < 30; i++) await attempt(limiter);
		timestamp += 1999;
		expect((await attempt(limiter)).allowed).toBe(false);
		timestamp += 1;
		expect((await attempt(limiter)).allowed).toBe(true);
		expect((await attempt(limiter)).allowed).toBe(false);
		timestamp += 120000;
		for (let i = 0; i < 30; i++) expect((await attempt(limiter)).allowed).toBe(true);
		expect((await attempt(limiter)).allowed).toBe(false);
	});

	test("sets and refreshes the 60 second inactivity expiration", async () => {
		const key = "ratelimit:ws_handshake:203.0.113.5";
		await attempt(limiter);
		expect(await redis.pttl(key)).toBeGreaterThan(59000);
		await redis.pexpire(key, 1000);
		await attempt(limiter);
		expect(await redis.pttl(key)).toBeGreaterThan(59000);
		expect(await redis.pttl(key)).toBeLessThanOrEqual(60000);
	});

	test("separates IP buckets and recreates an expired Redis bucket", async () => {
		for (let i = 0; i < 30; i++) await attempt(limiter);
		expect((await attempt(limiter)).allowed).toBe(false);
		expect((await attempt(limiter, "203.0.113.6")).allowed).toBe(true);
		await redis.del("ratelimit:ws_handshake:203.0.113.5");
		expect((await attempt(limiter)).allowed).toBe(true);
	});

	test("uses the same limit when Redis is disabled", async () => {
		const local = createSocketRateLimiter({ getRedis: () => null, now: () => timestamp });
		for (let i = 0; i < 30; i++) expect((await attempt(local)).allowed).toBe(true);
		expect((await attempt(local)).allowed).toBe(false);
		timestamp += 2000;
		expect((await attempt(local)).allowed).toBe(true);
	});

	test("preserves attempts from before a Redis outage and recovers afterward", async () => {
		for (let i = 0; i < 30; i++) await attempt(limiter);
		jest.spyOn(redis, "eval").mockRejectedValue(new Error("Redis unavailable"));
		expect((await attempt(limiter)).allowed).toBe(false);
		timestamp += 2000;
		expect((await attempt(limiter)).allowed).toBe(true);
		redis.eval.mockRestore();
		expect((await attempt(limiter)).allowed).toBe(true);
		expect((await attempt(limiter)).allowed).toBe(false);
	});

	test("bounds fallback memory and evicts the least recently used IP", async () => {
		const local = createSocketRateLimiter({ max: 1, maxEntries: 2, getRedis: () => null, now: () => timestamp });
		await attempt(local, "203.0.113.1");
		await attempt(local, "203.0.113.2");
		expect((await attempt(local, "203.0.113.1")).allowed).toBe(false);
		await attempt(local, "203.0.113.3");
		expect((await attempt(local, "203.0.113.1")).allowed).toBe(false);
		expect((await attempt(local, "203.0.113.2")).allowed).toBe(true);
	});

	test("expires inactive fallback entries and supports resetting local state", async () => {
		const local = createSocketRateLimiter({ max: 1, getRedis: () => null, now: () => timestamp });
		await attempt(local);
		expect((await attempt(local)).allowed).toBe(false);
		timestamp += 60000;
		expect((await attempt(local)).allowed).toBe(true);
		local.reset();
		expect((await attempt(local)).allowed).toBe(true);
	});

	test("does not count requests belonging to an existing Engine.IO session", async () => {
		const next = jest.fn();
		await limiter(mockReq({ _query: { sid: "existing-session" } }), mockRes(), next);
		expect(next).toHaveBeenCalledTimes(1);
		expect(await redis.keys("ratelimit:ws_handshake:*")).toEqual([]);
	});

	test("limits loopback IPs and ignores spoofed forwarding headers", async () => {
		const local = createSocketRateLimiter({ max: 1, getRedis: () => null, trustedProxies: [] });
		await local(mockReq({ socket: { remoteAddress: "127.0.0.1" }, headers: { "x-forwarded-for": "203.0.113.1" } }), mockRes(), jest.fn());
		const res = mockRes();
		await local(mockReq({ socket: { remoteAddress: "127.0.0.1" }, headers: { "x-forwarded-for": "203.0.113.2" } }), res, jest.fn());
		expect(res.writeHead).toHaveBeenCalledWith(429, expect.anything());
	});

	test("uses the first untrusted peer behind configured trusted proxies", async () => {
		const local = createSocketRateLimiter({ max: 1, getRedis: () => null, trustedProxies: ["loopback"] });
		for (const forwarded of ["1.1.1.1, 203.0.113.5", "2.2.2.2, 203.0.113.5"]) {
			const res = mockRes();
			await local(mockReq({ socket: { remoteAddress: "127.0.0.1" }, headers: { "x-forwarded-for": forwarded } }), res, jest.fn());
			if (forwarded.startsWith("2")) expect(res.writeHead).toHaveBeenCalledWith(429, expect.anything());
			else expect(res.writeHead).not.toHaveBeenCalled();
		}
	});
});

describe("handshake IP normalization", () => {
	test.each([
		["203.0.113.5", "203.0.113.5"],
		["::ffff:203.0.113.5", "203.0.113.5"],
		["::ffff:cb00:7105", "203.0.113.5"],
		["2001:DB8::1", "2001:0db8:0000:0000:0000:0000:0000:0001"],
		["bogus", "unknown"],
	])("normalizes %s to %s", (ip, expected) => {
		expect(getClientIp(mockReq({ socket: { remoteAddress: ip } }))).toBe(expected);
	});
	test("handles missing socket information and older connection objects", () => {
		expect(getClientIp({ headers: {} })).toBe("unknown");
		expect(getClientIp({ connection: { remoteAddress: "203.0.113.5" } })).toBe("203.0.113.5");
	});
});

describe("limiter attached to the real Engine.IO server", () => {
	let httpServer;
	let io;
	let url;
	afterEach(async () => {
		if (io) await new Promise((resolve) => io.close(resolve));
	});
	async function startServer(max = 2) {
		httpServer = http.createServer();
		io = new Server(httpServer);
		io.engine.use(createSocketRateLimiter({ max, getRedis: () => null, now: () => 1000, trustedProxies: [] }));
		await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
		url = `http://127.0.0.1:${httpServer.address().port}`;
	}

	test.each([false, true])("rejects excess initial handshakes before allocation (upgrade: %s)", async (upgrade) => {
		await startServer();
		expect((await handshakeRequest(url, upgrade)).status).toBe(upgrade ? 101 : 200);
		expect((await handshakeRequest(url, upgrade)).status).toBe(upgrade ? 101 : 200);
		const blocked = await handshakeRequest(url, upgrade);
		expect(blocked.status).toBe(429);
		expect(blocked.headers["retry-after"]).toBe("30");
		expect(JSON.parse(blocked.body).error).toBe("Too many connection attempts");
	});

	test("allows a legitimate polling session to connect and upgrade using one token", async () => {
		await startServer(1);
		const socket = Client(url, { reconnection: false });
		try {
			await new Promise((resolve, reject) => {
				socket.on("connect_error", reject);
				socket.io.engine.on("upgrade", resolve);
			});
			expect(socket.io.engine.transport.name).toBe("websocket");
			expect((await handshakeRequest(url)).status).toBe(429);
		} finally {
			socket.disconnect();
		}
	});
});
