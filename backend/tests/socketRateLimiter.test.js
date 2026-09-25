const http = require("http");
const { Server } = require("socket.io");
const { createSocketRateLimiter, getClientIp } = require("../middleware/socketRateLimiter");

function handshakeRequest(url) {
	return new Promise((resolve, reject) => {
		http
			.get(`${url}/socket.io/?EIO=4&transport=polling`, (res) => {
				res.resume();
				res.on("end", () => resolve(res.statusCode));
			})
			.on("error", reject);
	});
}

function mockReq(overrides = {}) {
	return {
		headers: {},
		socket: { remoteAddress: "203.0.113.5" },
		...overrides,
	};
}

function mockRes() {
	return {
		writeHead: jest.fn(),
		end: jest.fn(),
	};
}

describe("socketRateLimiter middleware", () => {
	describe("createSocketRateLimiter", () => {
		it("allows handshakes under the limit and calls next()", () => {
			const limiter = createSocketRateLimiter({ windowMs: 60_000, max: 5, whitelist: new Set() });
			const next = jest.fn();

			limiter(mockReq(), mockRes(), next);

			expect(next).toHaveBeenCalled();
		});

		it("rejects handshakes over the limit with HTTP 429", () => {
			const limiter = createSocketRateLimiter({ windowMs: 60_000, max: 3, whitelist: new Set() });
			const req = mockReq();

			for (let i = 0; i < 3; i++) {
				limiter(req, mockRes(), jest.fn());
			}

			const res = mockRes();
			const next = jest.fn();
			limiter(req, res, next);

			expect(next).not.toHaveBeenCalled();
			expect(res.writeHead).toHaveBeenCalledWith(
				429,
				expect.objectContaining({ "Content-Type": "application/json" }),
			);
			expect(res.end).toHaveBeenCalledWith(
				expect.stringContaining("Too many connection attempts"),
			);
		});

		it("tracks separate counters per IP", () => {
			const limiter = createSocketRateLimiter({ windowMs: 60_000, max: 1, whitelist: new Set() });

			limiter(mockReq({ socket: { remoteAddress: "1.1.1.1" } }), mockRes(), jest.fn());

			const blocked = mockRes();
			limiter(mockReq({ socket: { remoteAddress: "1.1.1.1" } }), blocked, jest.fn());
			expect(blocked.writeHead).toHaveBeenCalledWith(429, expect.anything());

			const allowedNext = jest.fn();
			limiter(mockReq({ socket: { remoteAddress: "2.2.2.2" } }), mockRes(), allowedNext);
			expect(allowedNext).toHaveBeenCalled();
		});

		it("resets the count after the window elapses", () => {
			jest.useFakeTimers();
			try {
				const limiter = createSocketRateLimiter({ windowMs: 1000, max: 1, whitelist: new Set() });
				const req = mockReq();

				limiter(req, mockRes(), jest.fn());

				const blocked = mockRes();
				limiter(req, blocked, jest.fn());
				expect(blocked.writeHead).toHaveBeenCalledWith(429, expect.anything());

				jest.advanceTimersByTime(1001);

				const afterWindow = mockRes();
				const next = jest.fn();
				limiter(req, afterWindow, next);

				expect(next).toHaveBeenCalled();
				expect(afterWindow.writeHead).not.toHaveBeenCalled();
			} finally {
				jest.useRealTimers();
			}
		});

		it("whitelists loopback addresses by default regardless of volume", () => {
			const limiter = createSocketRateLimiter({ windowMs: 60_000, max: 1 });
			const req = mockReq({ socket: { remoteAddress: "127.0.0.1" } });

			for (let i = 0; i < 10; i++) {
				const next = jest.fn();
				limiter(req, mockRes(), next);
				expect(next).toHaveBeenCalled();
			}
		});

		it("honors x-forwarded-for over the raw socket address", () => {
			const limiter = createSocketRateLimiter({ windowMs: 60_000, max: 1, whitelist: new Set() });
			const req = mockReq({ headers: { "x-forwarded-for": "9.9.9.9, 10.0.0.1" } });

			limiter(req, mockRes(), jest.fn());

			const blocked = mockRes();
			limiter(mockReq({ headers: { "x-forwarded-for": "9.9.9.9" } }), blocked, jest.fn());
			expect(blocked.writeHead).toHaveBeenCalledWith(429, expect.anything());
		});

		it("exposes a reset() helper that clears tracked counts", () => {
			const limiter = createSocketRateLimiter({ windowMs: 60_000, max: 1, whitelist: new Set() });
			const req = mockReq();

			limiter(req, mockRes(), jest.fn());
			limiter.reset();

			const next = jest.fn();
			limiter(req, mockRes(), next);
			expect(next).toHaveBeenCalled();
		});
	});

	describe("getClientIp", () => {
		it("falls back to the socket remote address when no proxy header is set", () => {
			expect(getClientIp(mockReq())).toBe("203.0.113.5");
		});

		it("returns unknown when neither header nor socket info is available", () => {
			expect(getClientIp({ headers: {} })).toBe("unknown");
		});
	});

	describe("attached to io.engine", () => {
		let httpServer;
		let io;
		let limiter;
		let url;

		afterEach(async () => {
			if (io) io.close();
			if (httpServer) await new Promise((resolve) => httpServer.close(resolve));
		});

		async function startServer(limiterOptions) {
			httpServer = http.createServer();
			io = new Server(httpServer, { cors: { origin: "*" } });
			limiter = createSocketRateLimiter(limiterOptions);
			io.engine.use((req, res, next) => limiter(req, res, next));
			await new Promise((resolve) => httpServer.listen(0, resolve));
			url = `http://127.0.0.1:${httpServer.address().port}`;
		}

		it("blocks excess handshake attempts from the same IP with HTTP 429", async () => {
			// Disable the loopback whitelist so the local test client is subject
			// to the same limiting a real remote IP would face.
			await startServer({ windowMs: 60_000, max: 2, whitelist: new Set() });

			const first = await handshakeRequest(url);
			const second = await handshakeRequest(url);
			const third = await handshakeRequest(url);

			expect(first).toBe(200);
			expect(second).toBe(200);
			expect(third).toBe(429);
		});

		it("still allows handshakes from an IP under the limit", async () => {
			await startServer({ windowMs: 60_000, max: 30, whitelist: new Set() });

			const status = await handshakeRequest(url);

			expect(status).toBe(200);
		});

		it("whitelists loopback handshakes by default even past the limit", async () => {
			await startServer({ windowMs: 60_000, max: 1 });

			const first = await handshakeRequest(url);
			const second = await handshakeRequest(url);

			expect(first).toBe(200);
			expect(second).toBe(200);
		});
	});
});
