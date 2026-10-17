const { createRateLimiter, createAuthChallengeRateLimiter } = require("../middleware/rateLimiter");
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
	describe("createAuthChallengeRateLimiter", () => {
		it("allows requests under both the IP and address limits", () => {
			const limiter = createAuthChallengeRateLimiter({ windowMs: 60_000, ipMax: 10, subnetMax: 50, addressMax: 3 });
			const req = mockReq({ body: { address: "GABC" } });
			const res = mockRes();
			const next = jest.fn();

			limiter(req, res, next);

			expect(next).toHaveBeenCalled();
			expect(res.status).not.toHaveBeenCalled();
		});

		it("rejects the 11th request from the same IP with 429 and Retry-After", () => {
			const limiter = createAuthChallengeRateLimiter({ windowMs: 60_000, ipMax: 10, subnetMax: 100, addressMax: 100 });
			const req = mockReq({ ip: "9.9.9.9", body: { address: null } });

			for (let i = 0; i < 10; i++) {
				const req2 = mockReq({ ip: "9.9.9.9", body: { address: `GADDR${i}` } });
				limiter(req2, mockRes(), jest.fn());
			}

			const res = mockRes();
			const next = jest.fn();
			limiter(mockReq({ ip: "9.9.9.9", body: { address: "GADDR_OVER" } }), res, next);

			expect(res.status).toHaveBeenCalledWith(429);
			expect(res.json).toHaveBeenCalledWith(
				expect.objectContaining({ error: "Too Many Requests", retryAfter: expect.any(Number) }),
			);
			expect(res.set).toHaveBeenCalledWith("Retry-After", expect.any(String));
			expect(next).not.toHaveBeenCalled();
		});

		it("rejects the 4th pending challenge for the same wallet address with 429", () => {
			const limiter = createAuthChallengeRateLimiter({ windowMs: 60_000, ipMax: 100, subnetMax: 100, addressMax: 3 });

			for (let i = 0; i < 3; i++) {
				const req = mockReq({ ip: `1.1.1.${i}`, body: { address: "GSAME" } });
				limiter(req, mockRes(), jest.fn());
			}

			const res = mockRes();
			const next = jest.fn();
			limiter(mockReq({ ip: "1.1.1.9", body: { address: "GSAME" } }), res, next);

			expect(res.status).toHaveBeenCalledWith(429);
			expect(res.json).toHaveBeenCalledWith(
				expect.objectContaining({ error: "Too Many Requests", retryAfter: expect.any(Number) }),
			);
			expect(next).not.toHaveBeenCalled();
		});

		it("does not enforce the address limit when no address is present", () => {
			const limiter = createAuthChallengeRateLimiter({ windowMs: 60_000, ipMax: 100, subnetMax: 100, addressMax: 1 });

			for (let i = 0; i < 5; i++) {
				const req = mockReq({ ip: `2.2.2.${i}`, body: {} });
				limiter(req, mockRes(), jest.fn());
			}

			const res = mockRes();
			const next = jest.fn();
			limiter(mockReq({ ip: "2.2.2.9", body: {} }), res, next);

			expect(next).toHaveBeenCalled();
			expect(res.status).not.toHaveBeenCalled();
		});

		it("tracks separate address windows independently of IP", () => {
			const limiter = createAuthChallengeRateLimiter({ windowMs: 60_000, ipMax: 100, subnetMax: 100, addressMax: 3 });

			for (let i = 0; i < 3; i++) {
				limiter(mockReq({ ip: "3.3.3.1", body: { address: "GWALLET" } }), mockRes(), jest.fn());
			}

			const blocked = mockRes();
			limiter(mockReq({ ip: "3.3.3.1", body: { address: "GWALLET" } }), blocked, jest.fn());
			expect(blocked.status).toHaveBeenCalledWith(429);

			const otherWallet = mockRes();
			const next = jest.fn();
			limiter(mockReq({ ip: "3.3.3.1", body: { address: "GOTHER" } }), otherWallet, next);
			expect(next).toHaveBeenCalled();
		});

		it("exposes a reset() helper that clears both windows", () => {
			const limiter = createAuthChallengeRateLimiter({ windowMs: 60_000, ipMax: 1, subnetMax: 1, addressMax: 1 });
			const req = mockReq({ ip: "4.4.4.4", body: { address: "GRESET" } });

			limiter(req, mockRes(), jest.fn());
			limiter.reset();

			const res = mockRes();
			const next = jest.fn();
			limiter(req, res, next);

			expect(next).toHaveBeenCalled();
			expect(res.status).not.toHaveBeenCalled();
		});

		describe("Subnet rate limiting (three-tier: IP, subnet, address)", () => {
			it("enforces per-IP limit independently", () => {
				const mockSubnetKeyGen = (ip) => `subnet-${ip.split(".").slice(0, 3).join(".")}`;
				const limiter = createAuthChallengeRateLimiter({
					windowMs: 60_000,
					ipMax: 2,
					subnetMax: 100,
					addressMax: 100,
					subnetKeyGenerator: mockSubnetKeyGen,
				});

				// First IP, 2 requests should pass
				const req1a = mockReq({ ip: "10.0.0.1", body: { address: "GADDR1" } });
				const req1b = mockReq({ ip: "10.0.0.1", body: { address: "GADDR2" } });
				limiter(req1a, mockRes(), jest.fn());
				limiter(req1b, mockRes(), jest.fn());

				// Third request from same IP should be rejected
				const req1c = mockReq({ ip: "10.0.0.1", body: { address: "GADDR3" } });
				const res1c = mockRes();
				limiter(req1c, res1c, jest.fn());
				expect(res1c.status).toHaveBeenCalledWith(429);

				// Different IP in same /24 should still have its own limit
				const req2a = mockReq({ ip: "10.0.0.2", body: { address: "GADDR4" } });
				const res2a = mockRes();
				const next2a = jest.fn();
				limiter(req2a, res2a, next2a);
				expect(next2a).toHaveBeenCalled(); // First request from this IP passes
			});

			it("enforces subnet limit across different IPs", () => {
				const mockSubnetKeyGen = (ip) => `subnet-${ip.split(".").slice(0, 3).join(".")}`;
				const limiter = createAuthChallengeRateLimiter({
					windowMs: 60_000,
					ipMax: 100,
					subnetMax: 3,
					addressMax: 100,
					subnetKeyGenerator: mockSubnetKeyGen,
				});

				// Make 3 requests from different IPs in same /24
				limiter(mockReq({ ip: "10.0.0.1", body: { address: "GADDR1" } }), mockRes(), jest.fn());
				limiter(mockReq({ ip: "10.0.0.2", body: { address: "GADDR2" } }), mockRes(), jest.fn());
				limiter(mockReq({ ip: "10.0.0.3", body: { address: "GADDR3" } }), mockRes(), jest.fn());

				// Fourth request from different IP in same subnet should fail (subnet limit exceeded)
				const req4 = mockReq({ ip: "10.0.0.4", body: { address: "GADDR4" } });
				const res4 = mockRes();
				limiter(req4, res4, jest.fn());
				expect(res4.status).toHaveBeenCalledWith(429);
			});

			it("subnet limit does not affect requests from different subnet", () => {
				const mockSubnetKeyGen = (ip) => `subnet-${ip.split(".").slice(0, 3).join(".")}`;
				const limiter = createAuthChallengeRateLimiter({
					windowMs: 60_000,
					ipMax: 100,
					subnetMax: 2,
					addressMax: 100,
					subnetKeyGenerator: mockSubnetKeyGen,
				});

				// Exhaust subnet limit for first subnet
				limiter(mockReq({ ip: "10.0.0.1", body: { address: "GADDR1" } }), mockRes(), jest.fn());
				limiter(mockReq({ ip: "10.0.0.2", body: { address: "GADDR2" } }), mockRes(), jest.fn());

				// Request from different subnet should not be affected
				const diffSubnet = mockReq({ ip: "10.0.1.1", body: { address: "GADDR3" } });
				const res = mockRes();
				const next = jest.fn();
				limiter(diffSubnet, res, next);
				expect(next).toHaveBeenCalled();
				expect(res.status).not.toHaveBeenCalled();
			});

			it("IP limit takes precedence and is checked first", () => {
				const mockSubnetKeyGen = (ip) => `subnet-${ip.split(".").slice(0, 3).join(".")}`;
				const limiter = createAuthChallengeRateLimiter({
					windowMs: 60_000,
					ipMax: 1,
					subnetMax: 100,
					addressMax: 100,
					subnetKeyGenerator: mockSubnetKeyGen,
				});

				// First request passes
				limiter(mockReq({ ip: "10.0.0.1", body: { address: "GADDR1" } }), mockRes(), jest.fn());

				// Second request from same IP is rejected by IP limit
				const res2 = mockRes();
				limiter(mockReq({ ip: "10.0.0.1", body: { address: "GADDR2" } }), res2, jest.fn());
				expect(res2.status).toHaveBeenCalledWith(429);
			});

			it("subnet limit is checked after IP limit", () => {
				const mockSubnetKeyGen = (ip) => `subnet-${ip.split(".").slice(0, 3).join(".")}`;
				const limiter = createAuthChallengeRateLimiter({
					windowMs: 60_000,
					ipMax: 10,
					subnetMax: 1,
					addressMax: 100,
					subnetKeyGenerator: mockSubnetKeyGen,
				});

				// First request from IP 1 passes (within IP limit, subnet limit)
				limiter(mockReq({ ip: "10.0.0.1", body: { address: "GADDR1" } }), mockRes(), jest.fn());

				// Second request from IP 2 should be rejected by subnet limit
				const res2 = mockRes();
				limiter(mockReq({ ip: "10.0.0.2", body: { address: "GADDR2" } }), res2, jest.fn());
				expect(res2.status).toHaveBeenCalledWith(429);
			});

			it("both counters increment on each request regardless of rejection", () => {
				const mockSubnetKeyGen = (ip) => `subnet-${ip.split(".").slice(0, 3).join(".")}`;
				const limiter = createAuthChallengeRateLimiter({
					windowMs: 60_000,
					ipMax: 1,
					subnetMax: 3,
					addressMax: 100,
					subnetKeyGenerator: mockSubnetKeyGen,
				});

				// First request from IP 1 passes
				limiter(mockReq({ ip: "10.0.0.1", body: { address: "GADDR1" } }), mockRes(), jest.fn());

				// Second request from IP 1 fails (IP limit), but subnet counter still incremented
				limiter(mockReq({ ip: "10.0.0.1", body: { address: "GADDR2" } }), mockRes(), jest.fn());

				// Third request from IP 2 passes (within IP limit for that IP)
				const res3 = mockRes();
				const next3 = jest.fn();
				limiter(mockReq({ ip: "10.0.0.2", body: { address: "GADDR3" } }), res3, next3);
				expect(next3).toHaveBeenCalled();

				// Fourth request from IP 3 fails because subnet already has 2 increments (from first and second), this makes 3
				const res4 = mockRes();
				limiter(mockReq({ ip: "10.0.0.3", body: { address: "GADDR4" } }), res4, jest.fn());
				expect(res4.status).toHaveBeenCalledWith(429);
			});

			it("abusive single IP does not completely exhaust subnet budget for neighbors", () => {
				const mockSubnetKeyGen = (ip) => `subnet-${ip.split(".").slice(0, 3).join(".")}`;
				const limiter = createAuthChallengeRateLimiter({
					windowMs: 60_000,
					ipMax: 2,
					subnetMax: 10,
					addressMax: 100,
					subnetKeyGenerator: mockSubnetKeyGen,
				});

				// One IP tries to flood: makes 2 requests (hits its own limit)
				limiter(mockReq({ ip: "10.0.0.1", body: { address: "GADDR1" } }), mockRes(), jest.fn());
				limiter(mockReq({ ip: "10.0.0.1", body: { address: "GADDR2" } }), mockRes(), jest.fn());

				// Third request from same IP fails
				limiter(mockReq({ ip: "10.0.0.1", body: { address: "GADDR3" } }), mockRes(), jest.fn());

				// But neighbors can still make requests (subnet has used 2 of 10)
				for (let i = 2; i <= 7; i++) {
					const res = mockRes();
					const next = jest.fn();
					limiter(mockReq({ ip: `10.0.0.${i}`, body: { address: `GADDR${i}` } }), res, next);
					expect(next).toHaveBeenCalled(); // Should pass until subnet limit hit
					expect(res.status).not.toHaveBeenCalled();
				}

				// Eighth different IP would exceed subnet (8 total), should fail
				const res8 = mockRes();
				limiter(mockReq({ ip: "10.0.0.8", body: { address: "GADDR8" } }), res8, jest.fn());
				expect(res8.status).toHaveBeenCalledWith(429);
			});

			it("window reset clears all three counters", () => {
				const mockSubnetKeyGen = (ip) => `subnet-${ip.split(".").slice(0, 3).join(".")}`;
				const limiter = createAuthChallengeRateLimiter({
					windowMs: 60_000,
					ipMax: 1,
					subnetMax: 1,
					addressMax: 1,
					subnetKeyGenerator: mockSubnetKeyGen,
				});

				// Fill up all counters
				limiter(mockReq({ ip: "10.0.0.1", body: { address: "GADDR1" } }), mockRes(), jest.fn());

				// Verify they are blocked
				const res2 = mockRes();
				limiter(mockReq({ ip: "10.0.0.1", body: { address: "GADDR1" } }), res2, jest.fn());
				expect(res2.status).toHaveBeenCalledWith(429);

				// Reset all counters
				limiter.reset();

				// Should be able to make requests again
				const res3 = mockRes();
				const next3 = jest.fn();
				limiter(mockReq({ ip: "10.0.0.1", body: { address: "GADDR1" } }), res3, next3);
				expect(next3).toHaveBeenCalled();
				expect(res3.status).not.toHaveBeenCalled();
			});

			it("Retry-After header reflects remaining window time", () => {
				jest.useFakeTimers();
				try {
					const mockSubnetKeyGen = (ip) => `subnet-${ip.split(".").slice(0, 3).join(".")}`;
					const limiter = createAuthChallengeRateLimiter({
						windowMs: 10_000,
						ipMax: 1,
						subnetMax: 100,
						addressMax: 100,
						subnetKeyGenerator: mockSubnetKeyGen,
					});

					// First request
					limiter(mockReq({ ip: "10.0.0.1", body: { address: "GADDR1" } }), mockRes(), jest.fn());

					// Second request immediately after (IP limit exceeded)
					const res = mockRes();
					limiter(mockReq({ ip: "10.0.0.1", body: { address: "GADDR2" } }), res, jest.fn());

					expect(res.set).toHaveBeenCalledWith("Retry-After", "10");
					expect(res.json).toHaveBeenCalledWith(
						expect.objectContaining({ retryAfter: 10 }),
					);

					// Advance time 5 seconds
					jest.advanceTimersByTime(5000);

					const res2 = mockRes();
					limiter(mockReq({ ip: "10.0.0.1", body: { address: "GADDR3" } }), res2, jest.fn());

					// Should now report ~5 seconds remaining (allowing for timing variance)
					const retryAfterCall = res2.json.mock.calls[0][0];
					expect(retryAfterCall.retryAfter).toBeLessThanOrEqual(5);
					expect(retryAfterCall.retryAfter).toBeGreaterThan(0);
				} finally {
					jest.useRealTimers();
				}
			});

			it("uses getSubnetFromIp by default when no custom subnet key generator provided", () => {
				const limiter = createAuthChallengeRateLimiter({
					windowMs: 60_000,
					ipMax: 100,
					subnetMax: 2,
					addressMax: 100,
				});

				// Requests from IPv4 /24 should share subnet limit
				limiter(mockReq({ ip: "192.0.2.1", body: { address: "GADDR1" } }), mockRes(), jest.fn());
				limiter(mockReq({ ip: "192.0.2.2", body: { address: "GADDR2" } }), mockRes(), jest.fn());

				// Third request should fail (subnet limit of 2 exceeded)
				const res3 = mockRes();
				limiter(mockReq({ ip: "192.0.2.3", body: { address: "GADDR3" } }), res3, jest.fn());
				expect(res3.status).toHaveBeenCalledWith(429);

				// But different /24 should work
				const res4 = mockRes();
				const next4 = jest.fn();
				limiter(mockReq({ ip: "192.0.3.1", body: { address: "GADDR4" } }), res4, next4);
				expect(next4).toHaveBeenCalled();
			});
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
