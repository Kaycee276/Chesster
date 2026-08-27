const { createRateLimiter } = require("../middleware/rateLimiter");
const { sanitizeInput, containsDangerousPayload, stripHtml } = require("../middleware/sanitizeInput");

function mockReq(overrides = {}) {
	return { ip: "127.0.0.1", body: {}, query: {}, params: {}, ...overrides };
}

function mockRes() {
	const res = {};
	res.status = jest.fn().mockReturnValue(res);
	res.json = jest.fn().mockReturnValue(res);
	res.set = jest.fn().mockReturnValue(res);
	return res;
}

describe("rateLimiter", () => {
	describe("createRateLimiter", () => {
		it("allows requests under the limit and calls next()", () => {
			const limiter = createRateLimiter({ windowMs: 60_000, max: 5 });
			const req = mockReq();
			const res = mockRes();
			const next = jest.fn();

			limiter(req, res, next);

			expect(next).toHaveBeenCalled();
			expect(res.status).not.toHaveBeenCalled();
		});

		it("sets rate limit headers on every request", () => {
			const limiter = createRateLimiter({ windowMs: 60_000, max: 5 });
			const req = mockReq();
			const res = mockRes();
			const next = jest.fn();

			limiter(req, res, next);

			expect(res.set).toHaveBeenCalledWith("X-RateLimit-Limit", "5");
			expect(res.set).toHaveBeenCalledWith("X-RateLimit-Remaining", "4");
		});

		it("rejects requests once the max is exceeded with a 429", () => {
			const limiter = createRateLimiter({ windowMs: 60_000, max: 3 });
			const req = mockReq();

			for (let i = 0; i < 3; i++) {
				limiter(req, mockRes(), jest.fn());
			}

			const res = mockRes();
			const next = jest.fn();
			limiter(req, res, next);

			expect(res.status).toHaveBeenCalledWith(429);
			expect(res.json).toHaveBeenCalledWith(
				expect.objectContaining({ success: false, error: expect.any(String) }),
			);
			expect(next).not.toHaveBeenCalled();
		});

		it("sets a Retry-After header when rejecting", () => {
			const limiter = createRateLimiter({ windowMs: 60_000, max: 1 });
			const req = mockReq();

			limiter(req, mockRes(), jest.fn());

			const res = mockRes();
			limiter(req, res, jest.fn());

			expect(res.set).toHaveBeenCalledWith("Retry-After", expect.any(String));
		});

		it("tracks separate counters per key", () => {
			const limiter = createRateLimiter({ windowMs: 60_000, max: 1 });
			const reqA = mockReq({ ip: "1.1.1.1" });
			const reqB = mockReq({ ip: "2.2.2.2" });

			limiter(reqA, mockRes(), jest.fn());

			const resA = mockRes();
			limiter(reqA, resA, jest.fn());
			expect(resA.status).toHaveBeenCalledWith(429);

			const resB = mockRes();
			const nextB = jest.fn();
			limiter(reqB, resB, nextB);
			expect(nextB).toHaveBeenCalled();
			expect(resB.status).not.toHaveBeenCalled();
		});

		it("resets the count after the window elapses", () => {
			jest.useFakeTimers();
			try {
				const limiter = createRateLimiter({ windowMs: 1000, max: 1 });
				const req = mockReq();

				limiter(req, mockRes(), jest.fn());

				const blocked = mockRes();
				limiter(req, blocked, jest.fn());
				expect(blocked.status).toHaveBeenCalledWith(429);

				jest.advanceTimersByTime(1001);

				const afterWindow = mockRes();
				const next = jest.fn();
				limiter(req, afterWindow, next);

				expect(next).toHaveBeenCalled();
				expect(afterWindow.status).not.toHaveBeenCalled();
			} finally {
				jest.useRealTimers();
			}
		});

		it("falls back to a default key when req.ip is unavailable", () => {
			const limiter = createRateLimiter({ windowMs: 60_000, max: 1 });
			const req = { body: {}, query: {}, params: {} };
			const next = jest.fn();

			limiter(req, mockRes(), next);

			expect(next).toHaveBeenCalled();
		});

		it("supports a custom keyGenerator", () => {
			const limiter = createRateLimiter({
				windowMs: 60_000,
				max: 1,
				keyGenerator: (req) => req.user?.id,
			});
			const reqUser1 = mockReq({ user: { id: "u1" } });
			const reqUser2 = mockReq({ user: { id: "u2" } });

			limiter(reqUser1, mockRes(), jest.fn());

			const blocked = mockRes();
			limiter(reqUser1, blocked, jest.fn());
			expect(blocked.status).toHaveBeenCalledWith(429);

			const allowed = mockRes();
			const next = jest.fn();
			limiter(reqUser2, allowed, next);
			expect(next).toHaveBeenCalled();
		});

		it("exposes a reset() helper that clears tracked counts", () => {
			const limiter = createRateLimiter({ windowMs: 60_000, max: 1 });
			const req = mockReq();

			limiter(req, mockRes(), jest.fn());
			limiter.reset();

			const res = mockRes();
			const next = jest.fn();
			limiter(req, res, next);

			expect(next).toHaveBeenCalled();
			expect(res.status).not.toHaveBeenCalled();
		});
	});
});

describe("sanitizeInput", () => {
	describe("containsDangerousPayload", () => {
		it.each([
			["<script>alert(1)</script>"],
			["javascript:alert(1)"],
			['<img src=x onerror="alert(1)">'],
			["' UNION SELECT password FROM users --"],
			["; DROP TABLE users;"],
			['{"$where": "this.password == this.username"}'],
		])("flags %p as dangerous", (payload) => {
			expect(containsDangerousPayload(payload)).toBe(true);
		});

		it.each([["hello world"], ["Player_1"], ["e4 e5 Nf3"], [""]])(
			"does not flag %p as dangerous",
			(payload) => {
				expect(containsDangerousPayload(payload)).toBe(false);
			},
		);

		it("returns false for non-string input", () => {
			expect(containsDangerousPayload(42)).toBe(false);
			expect(containsDangerousPayload(null)).toBe(false);
			expect(containsDangerousPayload(undefined)).toBe(false);
		});
	});

	describe("stripHtml", () => {
		it("removes tags and trims whitespace", () => {
			expect(stripHtml("  <b>hi</b>  ")).toBe("hi");
		});
	});

	describe("middleware", () => {
		it("calls next() for a clean payload", () => {
			const req = mockReq({ body: { username: "daniel" } });
			const res = mockRes();
			const next = jest.fn();

			sanitizeInput(req, res, next);

			expect(next).toHaveBeenCalled();
			expect(res.status).not.toHaveBeenCalled();
		});

		it("strips HTML tags from string fields in the body", () => {
			const req = mockReq({ body: { bio: "<b>bold</b> text" } });
			const res = mockRes();
			const next = jest.fn();

			sanitizeInput(req, res, next);

			expect(req.body.bio).toBe("bold text");
			expect(next).toHaveBeenCalled();
		});

		it("sanitizes nested objects and arrays in place", () => {
			const req = mockReq({
				body: { profile: { tags: ["<i>x</i>", "clean"] } },
			});
			const res = mockRes();
			const next = jest.fn();

			sanitizeInput(req, res, next);

			expect(req.body.profile.tags).toEqual(["x", "clean"]);
			expect(next).toHaveBeenCalled();
		});

		it("rejects a request body containing a script tag with 400", () => {
			const req = mockReq({ body: { comment: "<script>steal()</script>" } });
			const res = mockRes();
			const next = jest.fn();

			sanitizeInput(req, res, next);

			expect(res.status).toHaveBeenCalledWith(400);
			expect(res.json).toHaveBeenCalledWith(
				expect.objectContaining({ success: false, error: expect.any(String) }),
			);
			expect(next).not.toHaveBeenCalled();
		});

		it("rejects a SQL injection attempt in query params with 400", () => {
			const req = mockReq({ query: { search: "'; DROP TABLE users; --" } });
			const res = mockRes();
			const next = jest.fn();

			sanitizeInput(req, res, next);

			expect(res.status).toHaveBeenCalledWith(400);
			expect(next).not.toHaveBeenCalled();
		});

		it("rejects a malicious payload found in route params", () => {
			const req = mockReq({ params: { id: "javascript:alert(1)" } });
			const res = mockRes();
			const next = jest.fn();

			sanitizeInput(req, res, next);

			expect(res.status).toHaveBeenCalledWith(400);
			expect(next).not.toHaveBeenCalled();
		});

		it("handles missing body/query/params gracefully", () => {
			const req = { ip: "127.0.0.1" };
			const res = mockRes();
			const next = jest.fn();

			expect(() => sanitizeInput(req, res, next)).not.toThrow();
			expect(next).toHaveBeenCalled();
		});
	});
});
